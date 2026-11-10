// Cifrado de los datos guardados en el móvil (IndexedDB) con una clave derivada de la del piso.
// Solo quedan en claro el id, los campos indexados (para buscar y ordenar), «actualizado» y «borrado»;
// el resto del registro (importes, conceptos, fotos, notas…) se guarda como un bloque AES-256-GCM.
// Se usa AES-GCM síncrono (@noble/ciphers) porque WebCrypto es asíncrono y cerraría las transacciones de IndexedDB.
import { gcm } from '@noble/ciphers/aes.js'
import type Dexie from 'dexie'
import type { DBCore, DBCoreCursor, DBCoreTable } from 'dexie'

const SIN_CIFRAR = new Set(['config']) // claves ya protegidas y datos necesarios antes de desbloquear
const SIEMPRE_EN_CLARO = ['actualizado', 'borrado']
const CAMPO = '_c'

let clave: Uint8Array | null = null
let exigida = false // tras desbloquear una vez, no se escribe nada en claro aunque se bloquee

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Deriva la clave local (separada de la del piso) y la deja lista para cifrar. */
export async function activarCifradoLocal(rawClaveHogar: Uint8Array) {
  const datos = new Uint8Array([...enc.encode('piso-compartido-local-v1'), ...rawClaveHogar])
  clave = new Uint8Array(await crypto.subtle.digest('SHA-256', datos))
  exigida = true
}

/** Al bloquear la app la clave sale de la memoria: sin ella no se puede leer ni escribir nada cifrado. */
export function olvidarCifradoLocal() {
  clave?.fill(0)
  clave = null
}

export const cifradoLocalActivo = () => !!clave

function cifrar(valor: Record<string, unknown>, enClaro: Set<string>) {
  const visible: Record<string, unknown> = {}
  const oculto: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(valor)) (enClaro.has(k) ? visible : oculto)[k] = v
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const c = gcm(clave!, iv).encrypt(enc.encode(JSON.stringify(oculto)))
  const bloque = new Uint8Array(12 + c.length)
  bloque.set(iv)
  bloque.set(c, 12)
  visible[CAMPO] = bloque
  return visible
}

const descifrados = new WeakMap<object, unknown>()

function descifrar(valor: unknown): unknown {
  if (!valor || typeof valor !== 'object' || !(CAMPO in valor)) return valor // registro antiguo en claro
  const hecho = descifrados.get(valor)
  if (hecho) return hecho
  const { [CAMPO]: bloque, ...visible } = valor as Record<string, unknown>
  if (!clave) return visible // bloqueada: solo lo que ya estaba en claro, sin romper la pantalla de acceso
  const b = bloque as Uint8Array
  const oculto = JSON.parse(dec.decode(gcm(clave, b.subarray(0, 12)).decrypt(b.subarray(12))))
  const completo = { ...oculto, ...visible }
  descifrados.set(valor, completo)
  return completo
}

function camposEnClaro(tabla: DBCoreTable) {
  const s = new Set(SIEMPRE_EN_CLARO)
  for (const idx of [tabla.schema.primaryKey, ...tabla.schema.indexes]) {
    const kp = idx.keyPath
    for (const k of Array.isArray(kp) ? kp : kp ? [kp] : []) s.add(k.split('.')[0])
  }
  return s
}

/** Cursor que entrega los valores ya descifrados (los usan filter, each y modify). */
function cursorDescifrado(cursor: DBCoreCursor): DBCoreCursor {
  return new Proxy(cursor, {
    get(obj, prop) {
      if (prop === 'value') return descifrar(obj.value)
      const v = Reflect.get(obj, prop, obj)
      return typeof v === 'function' ? v.bind(obj) : v
    },
  })
}

export function usarCifradoLocal(db: Dexie) {
  db.use({
    stack: 'dbcore',
    name: 'cifradoLocal',
    create: (abajo: DBCore): DBCore => ({
      ...abajo,
      table(nombre) {
        const tabla = abajo.table(nombre)
        if (SIN_CIFRAR.has(nombre)) return tabla
        const enClaro = camposEnClaro(tabla)
        return {
          ...tabla,
          mutate(req) {
            if (req.type === 'add' || req.type === 'put') {
              if (!clave) {
                if (exigida) return Promise.reject(new Error('La app está bloqueada'))
                return tabla.mutate(req)
              }
              return tabla.mutate({ ...req, values: req.values.map((v) => cifrar(v as Record<string, unknown>, enClaro)) })
            }
            return tabla.mutate(req)
          },
          get: (req) => tabla.get(req).then(descifrar),
          getMany: (req) => tabla.getMany(req).then((r) => r.map(descifrar)),
          query: (req) => tabla.query(req).then((r) => (req.values ? { ...r, result: r.result.map(descifrar) } : r)),
          openCursor: (req) => tabla.openCursor(req).then((c) => (c && req.values !== false ? cursorDescifrado(c) : c)),
        }
      },
    }),
  })
}

/** Cifra los registros que quedaron en claro de versiones anteriores. Se ejecuta tras desbloquear. */
export async function cifrarRegistrosAntiguos(db: Dexie) {
  if (!clave) return
  for (const tabla of db.tables) {
    if (SIN_CIFRAR.has(tabla.name)) continue
    // Leer y volver a guardar: la capa de cifrado convierte cada registro en claro al pasar.
    await db.transaction('rw', tabla, async () => {
      const filas = await tabla.toArray()
      if (filas.length) await tabla.bulkPut(filas)
    })
  }
}
