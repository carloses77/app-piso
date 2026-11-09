// Sincronización con Supabase usado SOLO como buzón de mensajes cifrados.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { db, leerConfig, escribirConfig, TABLAS_SYNC, type EventoCola, type TablaSync, type Historial } from '../db'
import { aplicarRemoto } from '../db/operaciones'
import { cifrarJSON, descifrarJSON } from '../cripto'
import { reducirFoto } from '../logica/imagen'
import type { Sesion } from '../cripto/sesion'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let cliente: SupabaseClient | null = null
export const relayDisponible = () => !!(url && anon)
const sb = () => (cliente ??= createClient(url!, anon!, { auth: { persistSession: false } }))

export async function registrarDispositivo(s: Sesion) {
  if (!relayDisponible()) return
  const { error } = await sb().rpc('registrar_dispositivo', { p_hogar: s.hogarId, p_dispositivo: s.dispositivoId })
  if (error) throw new Error(error.message.includes('MAX_2') ? 'Este hogar ya tiene 2 dispositivos' : error.message)
}

const TABLAS_CON_AVISO: TablaSync[] = ['tareas', 'limpiezas']
const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** Suscribe este móvil a los avisos push. Se puede repetir: la suscripción se actualiza. */
export async function activarPush(s: Sesion): Promise<boolean> {
  if (!relayDisponible() || !vapid || !('PushManager' in window) || Notification.permission !== 'granted') return false
  const reg = await navigator.serviceWorker?.getRegistration()
  if (!reg) return false
  const clave = Uint8Array.from(atob(vapid.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave })
  const { endpoint, keys } = sub.toJSON()
  const { error } = await sb().rpc('guardar_suscripcion_push', {
    p_hogar: s.hogarId, p_dispositivo: s.dispositivoId, p_endpoint: endpoint, p_p256dh: keys?.p256dh, p_auth: keys?.auth,
  })
  return !error
}

/** Avisa al otro móvil. Si falla queda pendiente y se reintenta en la siguiente sincronización. */
async function enviarAvisoPendiente(s: Sesion) {
  if (!(await leerConfig('avisoPendiente'))) return
  const { error } = await sb().functions.invoke('avisar-cambio', { body: { hogar: s.hogarId, dispositivo: s.dispositivoId } })
  if (!error) await db.config.delete('avisoPendiente')
}

interface Paquete { tabla: TablaSync; registro: { id: string; actualizado: number }; historial?: Historial }

export type EstadoSync = 'ok' | 'offline' | 'sin-relay' | 'error' | 'no-autorizado' | 'limite'
export interface ResultadoSync { estado: EstadoSync; enviados: number; recibidos: number; descartados: number; ilegibles: number; detalle?: string }

// El servidor rechaza los eventos de 200.000 caracteres o más.
const MAX_PAYLOAD = 190_000
const TAM_LOTE = 500

const cifrarEvento = (s: Sesion, ev: EventoCola, registro: EventoCola['registro']) =>
  cifrarJSON(s.claveHogar, { tabla: ev.tabla, registro, historial: ev.historial })

/** Cifra el evento y, si no cabe, reduce su foto. Devuelve null si ni sin foto cabe. */
async function prepararEvento(s: Sesion, ev: EventoCola) {
  let registro = ev.registro as EventoCola['registro'] & { foto?: string }
  let payload = await cifrarEvento(s, ev, registro)
  for (let objetivo = 80_000; payload.length > MAX_PAYLOAD && registro.foto && objetivo >= 20_000; objetivo /= 2) {
    try {
      registro = { ...registro, foto: await reducirFoto(registro.foto, objetivo) }
      payload = await cifrarEvento(s, ev, registro)
    } catch {
      break
    }
  }
  if (payload.length > MAX_PAYLOAD && registro.foto) {
    const { foto: _, ...sinFoto } = registro
    payload = await cifrarEvento(s, ev, sinFoto)
  }
  return payload.length > MAX_PAYLOAD ? null : payload
}

const esRed = (m: string) => /fetch|network|load failed|timeout/i.test(m)
const fallo = (r: ResultadoSync, m: string): ResultadoSync => (esRed(m) ? { ...r, estado: 'offline' } : { ...r, estado: 'error', detalle: m })

/** Vuelve a dar de alta el móvil si el servidor no lo reconoce. Devuelve el fallo si no lo consigue. */
async function recuperarRegistro(s: Sesion): Promise<EstadoSync | null> {
  try {
    await registrarDispositivo(s)
    return null
  } catch (e) {
    return (e as Error).message.includes('2 dispositivos') ? 'limite' : 'no-autorizado'
  }
}

async function ciclo(s: Sesion): Promise<ResultadoSync> {
  const r: ResultadoSync = { estado: 'ok', enviados: 0, recibidos: 0, descartados: 0, ilegibles: 0 }
  if (!relayDisponible()) return { ...r, estado: 'sin-relay' }
  if (navigator.onLine === false) return { ...r, estado: 'offline' }

  // 1. Subir lo pendiente. Un evento imposible de enviar no debe frenar a los siguientes.
  const pendientes = await db.colaSync.orderBy('creado').toArray()
  let reintentado = false
  for (let i = 0; i < pendientes.length; i++) {
    const ev = pendientes[i]
    const payload = await prepararEvento(s, ev)
    if (payload === null) {
      await db.colaSync.delete(ev.id!)
      r.descartados++
      continue
    }
    const { error } = await sb().rpc('publicar_evento', { p_hogar: s.hogarId, p_dispositivo: s.dispositivoId, p_payload: payload })
    if (error?.message.includes('NO_AUTORIZADO') && !reintentado) {
      reintentado = true
      const estado = await recuperarRegistro(s)
      if (estado) return { ...r, estado }
      i--
      continue
    }
    if (error?.code === '23514') {
      await db.colaSync.delete(ev.id!)
      r.descartados++
      continue
    }
    if (error) return fallo(r, error.message)
    if (TABLAS_CON_AVISO.includes(ev.tabla)) await escribirConfig('avisoPendiente', '1')
    await db.colaSync.delete(ev.id!)
    r.enviados++
  }
  await enviarAvisoPendiente(s).catch(() => undefined)

  // 2. Bajar lo nuevo, por lotes hasta terminar.
  let max = Number((await leerConfig('ultimoSeq')) ?? 0)
  for (;;) {
    const { data, error } = await sb().rpc('leer_eventos', { p_hogar: s.hogarId, p_dispositivo: s.dispositivoId, p_desde: max })
    if (error?.message.includes('NO_AUTORIZADO') && !reintentado) {
      reintentado = true
      const estado = await recuperarRegistro(s)
      if (estado) return { ...r, estado }
      continue
    }
    if (error) return fallo(r, error.message)
    const filas = (data ?? []) as { seq: number; dispositivo: string; payload: string }[]
    for (const fila of filas) {
      if (fila.dispositivo !== s.dispositivoId) {
        let p: Paquete
        try {
          p = await descifrarJSON<Paquete>(s.claveHogar, fila.payload)
        } catch {
          r.ilegibles++
          max = Math.max(max, fila.seq)
          continue
        }
        if (TABLAS_SYNC.includes(p.tabla)) {
          // Si falla al guardar no se avanza: se reintenta en la siguiente sincronización.
          try {
            await aplicarRemoto(p.tabla, p.registro, p.historial)
          } catch (e) {
            await escribirConfig('ultimoSeq', String(max))
            return { ...r, estado: 'error', detalle: (e as Error).message }
          }
          r.recibidos++
        }
      }
      max = Math.max(max, fila.seq)
    }
    await escribirConfig('ultimoSeq', String(max))
    if (filas.length < TAM_LOTE) break
  }
  return r
}

let enCurso: Promise<ResultadoSync> | null = null
let repetir = false

/** Solo corre una sincronización a la vez; lo que se pida mientras tanto se atiende al acabar. */
export function sincronizar(s: Sesion): Promise<ResultadoSync> {
  if (enCurso) {
    repetir = true
    return enCurso
  }
  enCurso = (async () => {
    try {
      let r = await ciclo(s)
      while (repetir && r.estado === 'ok') {
        repetir = false
        const otro = await ciclo(s)
        r = { ...otro, enviados: r.enviados + otro.enviados, recibidos: r.recibidos + otro.recibidos, descartados: r.descartados + otro.descartados, ilegibles: r.ilegibles + otro.ilegibles }
      }
      return r
    } catch (e) {
      return { estado: 'error' as const, enviados: 0, recibidos: 0, descartados: 0, ilegibles: 0, detalle: (e as Error).message }
    } finally {
      repetir = false
      enCurso = null
    }
  })()
  return enCurso
}

export const ETIQUETA_SYNC: Record<string, string> = {
  '': '—', sincronizando: 'sincronizando…', ok: 'al día', offline: 'sin conexión', 'sin-relay': 'solo local',
  error: 'error', 'no-autorizado': 'móvil no autorizado', limite: 'límite de móviles alcanzado',
}

export function mensajeSync(r: ResultadoSync): { tipo: 'ok' | 'error'; texto: string } {
  switch (r.estado) {
    case 'ok': {
      const hubo = r.enviados || r.recibidos
      let texto = hubo ? `Sincronizado: ${r.enviados} enviados, ${r.recibidos} recibidos` : 'Todo al día'
      if (r.descartados) texto += ` · ${r.descartados} no se pudieron enviar por tamaño`
      if (r.ilegibles) texto += ` · ${r.ilegibles} ilegibles`
      return { tipo: r.descartados || r.ilegibles ? 'error' : 'ok', texto }
    }
    case 'offline': return { tipo: 'error', texto: 'Sin conexión con el servidor. Se reintentará solo.' }
    case 'sin-relay': return { tipo: 'error', texto: 'La sincronización no está configurada en esta versión.' }
    case 'limite': return { tipo: 'error', texto: 'Este piso ya tiene 2 móviles registrados: este no puede sincronizar.' }
    case 'no-autorizado': return { tipo: 'error', texto: 'El servidor no reconoce este móvil. Vuelve a unirte con una invitación.' }
    default: return { tipo: 'error', texto: `No se pudo sincronizar: ${r.detalle ?? 'error desconocido'}` }
  }
}

export async function borrarHogarRemoto(s: Sesion) {
  if (!relayDisponible()) return
  await sb().rpc('borrar_hogar', { p_hogar: s.hogarId, p_dispositivo: s.dispositivoId })
}
