// Sincronización con Supabase usado SOLO como buzón de mensajes cifrados.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { db, leerConfig, escribirConfig, TABLAS_SYNC, type TablaSync, type Historial } from '../db'
import { aplicarRemoto } from '../db/operaciones'
import { cifrarJSON, descifrarJSON } from '../cripto'
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

interface Paquete { tabla: TablaSync; registro: { id: string; actualizado: number }; historial?: Historial }

export async function sincronizar(s: Sesion): Promise<'ok' | 'offline' | 'sin-relay'> {
  if (!relayDisponible()) return 'sin-relay'
  if (!navigator.onLine) return 'offline'
  // 1. Subir lo pendiente
  const pendientes = await db.colaSync.orderBy('creado').toArray()
  for (const ev of pendientes) {
    const payload = await cifrarJSON(s.claveHogar, { tabla: ev.tabla, registro: ev.registro, historial: ev.historial })
    const { error } = await sb().rpc('publicar_evento', { p_hogar: s.hogarId, p_dispositivo: s.dispositivoId, p_payload: payload })
    if (error) return 'offline'
    await db.colaSync.delete(ev.id!)
  }
  // 2. Bajar lo nuevo del otro dispositivo
  const desde = Number((await leerConfig('ultimoSeq')) ?? 0)
  const { data, error } = await sb().rpc('leer_eventos', { p_hogar: s.hogarId, p_dispositivo: s.dispositivoId, p_desde: desde })
  if (error) return 'offline'
  let max = desde
  for (const fila of (data ?? []) as { seq: number; dispositivo: string; payload: string }[]) {
    max = Math.max(max, fila.seq)
    if (fila.dispositivo === s.dispositivoId) continue
    try {
      const p = await descifrarJSON<Paquete>(s.claveHogar, fila.payload)
      if (TABLAS_SYNC.includes(p.tabla)) await aplicarRemoto(p.tabla, p.registro, p.historial)
    } catch {
      /* paquete ilegible: se ignora */
    }
  }
  await escribirConfig('ultimoSeq', String(max))
  return 'ok'
}

export async function borrarHogarRemoto(s: Sesion) {
  if (!relayDisponible()) return
  await sb().rpc('borrar_hogar', { p_hogar: s.hogarId, p_dispositivo: s.dispositivoId })
}
