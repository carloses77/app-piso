import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import type { Sesion } from '../cripto/sesion'
import { generarClaveHogar, importarClaveHogar } from '../cripto'

// Servidor de mentira con las mismas reglas que las funciones SQL.
const servidor = vi.hoisted(() => ({
  eventos: [] as { seq: number; dispositivo: string; payload: string }[],
  dispositivos: new Set<string>(),
  fallarRed: false,
  lecturas: 0,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    functions: { invoke: async () => ({ error: null }) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: async (fn: string, a: Record<string, any>) => {
      if (servidor.fallarRed) return { error: { message: 'TypeError: Failed to fetch', code: '' } }
      if (fn === 'registrar_dispositivo') { servidor.dispositivos.add(a.p_dispositivo); return { error: null } }
      if (!servidor.dispositivos.has(a.p_dispositivo)) return { error: { message: 'NO_AUTORIZADO', code: 'P0001' } }
      if (fn === 'publicar_evento') {
        if (a.p_payload.length >= 200_000) return { error: { message: 'violates check constraint', code: '23514' } }
        servidor.eventos.push({ seq: servidor.eventos.length + 1, dispositivo: a.p_dispositivo, payload: a.p_payload })
        return { error: null }
      }
      if (fn === 'leer_eventos') {
        servidor.lecturas++
        return { data: servidor.eventos.filter((e) => e.seq > a.p_desde).slice(0, 500), error: null }
      }
      return { error: null }
    },
  }),
}))
vi.mock('../logica/imagen', () => ({ reducirFoto: async () => 'data:image/jpeg;base64,PEQUENA' }))

let relay: typeof import('./relay')
let ops: typeof import('../db/operaciones')
let clave: CryptoKey
const movil = (d: string, rol: 'A' | 'B'): Sesion => ({ claveHogar: clave, hogarId: 'piso', dispositivoId: d, rol })
const cambiarDeMovil = async () => { await db.delete(); await db.open() }
const pago = (concepto: string, extra = {}) => ({ periodoId: 'p', tipo: 'otro', concepto, importe: 1, fecha: '2026-11-09', pagadoPor: 'A', partePagador: 50, saldado: false, ...extra })

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://prueba.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  relay = await import('./relay')
  ops = await import('../db/operaciones')
  clave = await importarClaveHogar(generarClaveHogar())
})

beforeEach(async () => {
  servidor.eventos = []
  servidor.dispositivos = new Set(['A', 'B'])
  servidor.fallarRed = false
  servidor.lecturas = 0
  await cambiarDeMovil()
})

describe('replicación entre los dos móviles', () => {
  it('lo creado, editado y borrado en uno aparece en el otro, en ambos sentidos', async () => {
    const id = await ops.guardar('pagos', pago('Luz'), 'crear')
    expect((await relay.sincronizar(movil('A', 'A'))).enviados).toBe(1)

    await cambiarDeMovil()
    expect((await relay.sincronizar(movil('B', 'B'))).recibidos).toBe(1)
    expect((await db.pagos.get(id))?.concepto).toBe('Luz')
    await ops.guardar('pagos', { id, concepto: 'Luz editada' }, 'editar')
    await ops.borrar('pagos', id, 'borrar')
    await relay.sincronizar(movil('B', 'B'))

    await cambiarDeMovil()
    await relay.sincronizar(movil('A', 'A'))
    const final = await db.pagos.get(id)
    expect(final?.concepto).toBe('Luz editada')
    expect(final?.borrado).toBe(true)
  })

  it('una foto demasiado grande se reduce y no frena lo que viene detrás', async () => {
    await ops.guardar('pagos', pago('Con foto', { foto: 'x'.repeat(400_000) }), 'a')
    await ops.guardar('tareas', { periodoId: 'p', titulo: 'Después de la foto', estado: 'pendiente', asignadoA: 'B' }, 'b')
    const r = await relay.sincronizar(movil('A', 'A'))
    expect(r).toMatchObject({ estado: 'ok', enviados: 2, descartados: 0 })
    expect(await db.colaSync.count()).toBe(0)

    await cambiarDeMovil()
    await relay.sincronizar(movil('B', 'B'))
    expect((await db.pagos.toArray())[0].foto).toBe('data:image/jpeg;base64,PEQUENA')
    expect(await db.tareas.count()).toBe(1)
  })

  it('un evento imposible de enviar se aparta y avisa, sin bloquear la cola', async () => {
    await ops.guardar('tareas', { periodoId: 'p', titulo: 'x'.repeat(400_000), estado: 'pendiente', asignadoA: 'B' }, 'a')
    await ops.guardar('tareas', { periodoId: 'p', titulo: 'Normal', estado: 'pendiente', asignadoA: 'B' }, 'b')
    const r = await relay.sincronizar(movil('A', 'A'))
    expect(r).toMatchObject({ estado: 'ok', enviados: 1, descartados: 1 })
    expect(relay.mensajeSync(r).tipo).toBe('error')
  })

  it('descarga por lotes hasta traerlo todo de una vez', async () => {
    for (let i = 0; i < 1100; i++) await ops.guardar('compra', { nombre: `n${i}`, comprado: false, categoria: 'otros', añadidoPor: 'A' }, 'c')
    await relay.sincronizar(movil('A', 'A'))
    await cambiarDeMovil()
    servidor.lecturas = 0
    const r = await relay.sincronizar(movil('B', 'B'))
    expect(r.recibidos).toBe(1100)
    expect(await db.compra.count()).toBe(1100)
    expect(servidor.lecturas).toBe(3)
  })

  it('si no hay red conserva lo pendiente y lo envía después', async () => {
    await ops.guardar('tareas', { periodoId: 'p', titulo: 'T', estado: 'pendiente', asignadoA: 'B' }, 'a')
    servidor.fallarRed = true
    expect((await relay.sincronizar(movil('A', 'A'))).estado).toBe('offline')
    expect(await db.colaSync.count()).toBe(1)
    servidor.fallarRed = false
    expect((await relay.sincronizar(movil('A', 'A'))).enviados).toBe(1)
  })

  it('vuelve a registrar un móvil que el servidor no reconoce', async () => {
    servidor.dispositivos.delete('A')
    await ops.guardar('tareas', { periodoId: 'p', titulo: 'T', estado: 'pendiente', asignadoA: 'B' }, 'a')
    expect(await relay.sincronizar(movil('A', 'A'))).toMatchObject({ estado: 'ok', enviados: 1 })
  })

  it('dos sincronizaciones simultáneas no envían lo mismo dos veces', async () => {
    await ops.guardar('tareas', { periodoId: 'p', titulo: 'T', estado: 'pendiente', asignadoA: 'B' }, 'a')
    await Promise.all([relay.sincronizar(movil('A', 'A')), relay.sincronizar(movil('A', 'A'))])
    expect(servidor.eventos).toHaveLength(1)
  })

  it('el botón siempre tiene algo que decir', () => {
    const base = { enviados: 0, recibidos: 0, descartados: 0, ilegibles: 0 }
    expect(relay.mensajeSync({ ...base, estado: 'ok' }).texto).toBe('Todo al día')
    expect(relay.mensajeSync({ ...base, estado: 'ok', enviados: 2, recibidos: 1 }).texto).toContain('2 enviados')
    expect(relay.mensajeSync({ ...base, estado: 'limite' }).tipo).toBe('error')
  })
})

describe('marcas de tiempo', () => {
  it('una edición gana aunque el otro móvil tenga el reloj adelantado', async () => {
    const futuro = Date.now() + 3_600_000
    await ops.aplicarRemoto('tareas', { id: 't', actualizado: futuro, titulo: 'Remota' } as never)
    await ops.guardar('tareas', { id: 't', titulo: 'Local' }, 'e')
    const t = await db.tareas.get('t')
    expect(t?.titulo).toBe('Local')
    expect(t?.actualizado).toBeGreaterThan(futuro)
  })
})
