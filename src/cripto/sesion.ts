// Gestión de la clave personal, el hogar y el emparejamiento entre los 2 dispositivos.
import { db, leerConfig, escribirConfig, type Usuario } from '../db'
import { activarCifradoLocal, cifrarRegistrosAntiguos } from '../db/cifradoLocal'
import { aBase64, deBase64, aleatorio, cifrarBytes, descifrarBytes, derivarClave, generarClaveHogar, importarClaveHogar } from './index'

export interface Sesion { claveHogar: CryptoKey; hogarId: string; dispositivoId: string; rol: Usuario }

const CADUCIDAD_QR = 5 * 60 * 1000

export const estaConfigurado = async () => !!(await leerConfig('claveHogarCifrada'))

/** Protege la clave del hogar con la clave personal (que nunca se guarda ni se envía). */
async function protegerClaveHogar(raw: Uint8Array, clavePersonal: string) {
  const salt = aleatorio(16)
  const k = await derivarClave(clavePersonal, salt)
  await escribirConfig('salt', aBase64(salt))
  await escribirConfig('claveHogarCifrada', await cifrarBytes(k, raw))
}

const ALFABETO = 'ABCDEFGHJKMNPQRSTVWXYZ23456789' // sin 0/O, 1/I/L, U para evitar confusiones

/** Clave inicial legible (≈78 bits): XXXX-XXXX-XXXX-XXXX. Sirve también para recuperar la cuenta. */
export function generarClaveInicial() {
  const bytes = aleatorio(16)
  const txt = [...bytes].map((b) => ALFABETO[b % ALFABETO.length]).join('')
  return txt.match(/.{4}/g)!.join('-')
}
export const normalizarClaveInicial = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Guarda una segunda copia de la clave del hogar, protegida con la clave inicial (recuperación). */
async function protegerRecuperacion(raw: Uint8Array, claveInicial: string) {
  const salt = aleatorio(16)
  const k = await derivarClave(normalizarClaveInicial(claveInicial), salt)
  await escribirConfig('saltRec', aBase64(salt))
  await escribirConfig('claveHogarRec', await cifrarBytes(k, raw))
}

/** Prepara el cifrado de los datos del móvil; la primera vez convierte los registros que estaban en claro. */
async function prepararDatosLocales(raw: Uint8Array) {
  await activarCifradoLocal(raw)
  if ((await leerConfig('datosCifrados')) === '1') return
  await cifrarRegistrosAntiguos(db)
  await escribirConfig('datosCifrados', '1')
}

export async function crearHogar(clavePersonal: string, claveInicial: string): Promise<Sesion> {
  const raw = generarClaveHogar()
  await prepararDatosLocales(raw)
  const hogarId = aBase64(aleatorio(16))
  const dispositivoId = aBase64(aleatorio(16))
  await protegerClaveHogar(raw, clavePersonal)
  await protegerRecuperacion(raw, claveInicial)
  await escribirConfig('hogarId', hogarId)
  await escribirConfig('dispositivoId', dispositivoId)
  await escribirConfig('rol', 'A')
  return { claveHogar: await importarClaveHogar(raw), hogarId, dispositivoId, rol: 'A' }
}

/** Genera el código de invitación que A muestra como QR (caduca a los 5 minutos). */
export async function generarInvitacion(clavePersonal: string) {
  const raw = await abrirClaveHogarRaw(clavePersonal)
  const hogarId = (await leerConfig('hogarId'))!
  return aBase64(new TextEncoder().encode(JSON.stringify({ h: hogarId, k: aBase64(raw), e: Date.now() + CADUCIDAD_QR })))
}

/** Comprueba la invitación sin guardar nada (para validar antes de pedir la clave). */
export function leerInvitacion(codigo: string) {
  let datos: { h: string; k: string; e: number }
  try {
    datos = JSON.parse(new TextDecoder().decode(deBase64(codigo.trim())))
  } catch {
    throw new Error('Código de invitación no válido')
  }
  if (!datos.h || !datos.k) throw new Error('Código de invitación no válido')
  if (Date.now() > datos.e) throw new Error('La invitación ha caducado. Pide un QR nuevo.')
  return datos
}

export async function unirseConInvitacion(codigo: string, clavePersonal: string, claveInicial: string, rol: Usuario = 'B'): Promise<Sesion> {
  const datos = leerInvitacion(codigo)
  const raw = deBase64(datos.k)
  await prepararDatosLocales(raw)
  const dispositivoId = aBase64(aleatorio(16))
  await protegerClaveHogar(raw, clavePersonal)
  await protegerRecuperacion(raw, claveInicial)
  await escribirConfig('hogarId', datos.h)
  await escribirConfig('dispositivoId', dispositivoId)
  await escribirConfig('rol', rol)
  return { claveHogar: await importarClaveHogar(raw), hogarId: datos.h, dispositivoId, rol }
}

export async function abrirClaveHogarRaw(clavePersonal: string) {
  const salt = deBase64((await leerConfig('salt'))!)
  const k = await derivarClave(clavePersonal, salt)
  try {
    return await descifrarBytes(k, (await leerConfig('claveHogarCifrada'))!)
  } catch {
    throw new Error('Clave incorrecta')
  }
}

/** Retardo progresivo tras 5 fallos: 30 s, 60 s, 120 s... */
export async function esperaPendiente() {
  const hasta = Number((await leerConfig('bloqueadoHasta')) ?? 0)
  return Math.max(0, hasta - Date.now())
}

export async function sesionDesdeRaw(raw: Uint8Array): Promise<Sesion> {
  await prepararDatosLocales(raw)
  return {
    claveHogar: await importarClaveHogar(raw),
    hogarId: (await leerConfig('hogarId'))!,
    dispositivoId: (await leerConfig('dispositivoId'))!,
    rol: (await leerConfig('rol')) as Usuario,
  }
}

/** Ejecuta un intento de apertura contando fallos (retardo progresivo tras 5). */
async function conLimite<T>(fn: () => Promise<T>): Promise<T> {
  const espera = await esperaPendiente()
  if (espera > 0) throw new Error(`Demasiados intentos. Espera ${Math.ceil(espera / 1000)} s`)
  try {
    const r = await fn()
    await escribirConfig('fallos', '0')
    return r
  } catch (e) {
    const fallos = Number((await leerConfig('fallos')) ?? 0) + 1
    await escribirConfig('fallos', String(fallos))
    if (fallos >= 5) await escribirConfig('bloqueadoHasta', String(Date.now() + 30_000 * 2 ** (fallos - 5)))
    throw e
  }
}

export const desbloquear = (clavePersonal: string) =>
  conLimite(async () => sesionDesdeRaw(await abrirClaveHogarRaw(clavePersonal)))

/** «¿Olvidaste tu clave?»: con la clave inicial se abre la copia de recuperación y se fija una clave nueva. */
export const recuperarConClaveInicial = (claveInicial: string, nuevaClave: string) =>
  conLimite(async () => {
    const salt = await leerConfig('saltRec')
    if (!salt) throw new Error('Este móvil no tiene clave inicial guardada')
    const k = await derivarClave(normalizarClaveInicial(claveInicial), deBase64(salt))
    let raw: Uint8Array
    try {
      raw = await descifrarBytes(k, (await leerConfig('claveHogarRec'))!)
    } catch {
      throw new Error('Clave inicial incorrecta')
    }
    await protegerClaveHogar(raw, nuevaClave)
    return sesionDesdeRaw(raw)
  })

export async function cambiarClave(actual: string, nueva: string) {
  const raw = await abrirClaveHogarRaw(actual)
  await protegerClaveHogar(raw, nueva)
}

export async function borrarTodoLocal() {
  await db.delete()
  location.reload()
}
