import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Sesion } from '../cripto/sesion'
import { fijarUsuario } from '../db/operaciones'
import { sincronizar } from '../sync/relay'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Usuario } from '../db'

interface Ctx {
  sesion: Sesion | null
  entrar: (s: Sesion) => void
  bloquear: () => void
  estadoSync: string
  sincronizarYa: () => void
}
const Contexto = createContext<Ctx>(null!)
export const useSesion = () => useContext(Contexto)

const INACTIVIDAD = 2 * 60 * 1000

// Elegir un archivo manda la app a segundo plano y el OCR puede tardar minutos sin que se toque
// la pantalla. Esta pausa evita perder el trabajo y caduca sola para no anular el bloqueo.
let bloqueoPausadoHasta = 0
export const pausarBloqueo = (ms: number) => { bloqueoPausadoHasta = Date.now() + ms }
export const reanudarBloqueo = () => { bloqueoPausadoHasta = 0 }
const bloqueoEnPausa = () => Date.now() < bloqueoPausadoHasta

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(null)
  const [estadoSync, setEstadoSync] = useState('')
  const temporizador = useRef<number>(0)

  const bloquear = useCallback(() => setSesion(null), [])
  const entrar = (s: Sesion) => {
    fijarUsuario(s.rol)
    setSesion(s)
  }

  const sincronizarYa = useCallback(async () => {
    if (!sesion) return
    setEstadoSync('sincronizando')
    setEstadoSync(await sincronizar(sesion))
  }, [sesion])

  // Bloqueo al pasar a segundo plano y por inactividad
  useEffect(() => {
    if (!sesion) return
    const reiniciar = () => {
      clearTimeout(temporizador.current)
      temporizador.current = window.setTimeout(() => (bloqueoEnPausa() ? reiniciar() : bloquear()), INACTIVIDAD)
    }
    const visibilidad = () => document.hidden && !bloqueoEnPausa() && bloquear()
    const eventos = ['pointerdown', 'keydown', 'scroll']
    eventos.forEach((e) => window.addEventListener(e, reiniciar, { passive: true }))
    document.addEventListener('visibilitychange', visibilidad)
    reiniciar()
    return () => {
      clearTimeout(temporizador.current)
      eventos.forEach((e) => window.removeEventListener(e, reiniciar))
      document.removeEventListener('visibilitychange', visibilidad)
    }
  }, [sesion, bloquear])

  // Sincronización periódica cada 20 s mientras está desbloqueada
  useEffect(() => {
    if (!sesion) return
    sincronizarYa()
    const i = setInterval(sincronizarYa, 20_000)
    window.addEventListener('online', sincronizarYa)
    return () => {
      clearInterval(i)
      window.removeEventListener('online', sincronizarYa)
    }
  }, [sesion, sincronizarYa])

  return <Contexto.Provider value={{ sesion, entrar, bloquear, estadoSync, sincronizarYa }}>{children}</Contexto.Provider>
}

/** Alias visibles de cada usuario (guardados cifrados y sincronizados). */
export function useAlias(): Record<Usuario, string> {
  const filas = useLiveQuery(() => db.ajustes.where('id').anyOf('alias-A', 'alias-B').toArray(), [])
  const m = Object.fromEntries((filas ?? []).map((f) => [f.id, f.valor]))
  return { A: m['alias-A'] || 'Compi 1', B: m['alias-B'] || 'Compi 2' }
}
