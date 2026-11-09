import { useState } from 'react'
import { useSesion } from './useSesion'
import { useToast } from './useAvisos'
import { mensajeSync } from '../sync/relay'

/** Sincronización pedida a mano: siempre muestra qué ha pasado. */
export function useBotonSync() {
  const { sincronizarYa } = useSesion()
  const toast = useToast()
  const [girando, setGirando] = useState(false)

  async function sincronizarAhora() {
    setGirando(true)
    const [r] = await Promise.all([sincronizarYa(), new Promise((listo) => setTimeout(listo, 500))])
    setGirando(false)
    if (r) toast(mensajeSync(r))
  }
  return { sincronizarAhora, girando }
}
