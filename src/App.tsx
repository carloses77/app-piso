import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { LayoutDashboard, Wallet, Landmark, Sparkles, Car, Settings, TriangleAlert, type LucideIcon } from 'lucide-react'
import { ProveedorSesion, useSesion } from './hooks/useSesion'
import { asegurarPeriodo } from './db/operaciones'
import { generarRecurrentes } from './logica/recurrentes'
import { ProveedorToasts, useTema, vibrar } from './hooks/useAvisos'
import { relayDisponible } from './sync/relay'
import Acceso from './pages/Acceso'
import Inicio from './pages/Inicio'
import Pagos from './pages/Pagos'
import Banco from './pages/Banco'
import Casa from './pages/Casa'
import Parking from './pages/Parking'
import Mas from './pages/Mas'

const SECCIONES: { id: string; texto: string; icono: LucideIcon; Vista: (p: { ir: (s: string) => void }) => React.ReactNode }[] = [
  { id: 'inicio', texto: 'Inicio', icono: LayoutDashboard, Vista: Inicio },
  { id: 'pagos', texto: 'Pagos', icono: Wallet, Vista: Pagos },
  { id: 'banco', texto: 'Banco', icono: Landmark, Vista: Banco },
  { id: 'casa', texto: 'Casa', icono: Sparkles, Vista: Casa },
  { id: 'parking', texto: 'Parking', icono: Car, Vista: Parking },
  { id: 'mas', texto: 'Más', icono: Settings, Vista: Mas },
]

const AVISO_SYNC: Record<string, string> = {
  'sin-relay': 'Sin servidor: los cambios se quedan en este móvil y el otro no los verá.',
  'no-autorizado': 'El servidor no reconoce este móvil. Vuelve a unirte con una invitación.',
  limite: 'El piso ya tiene 2 móviles: este no puede compartir cambios.',
}

/** Aviso fijo cuando este móvil no puede compartir cambios (no se muestra por falta de internet, que se reintenta sola). */
function AvisoSync() {
  const { estadoSync } = useSesion()
  const texto = !relayDisponible() ? AVISO_SYNC['sin-relay'] : AVISO_SYNC[estadoSync]
  if (!texto) return null
  return (
    <div role="alert" className="mx-auto mt-[max(0.75rem,env(safe-area-inset-top))] mb-1 flex max-w-lg items-start gap-2 rounded-2xl border border-a/40 bg-a/15 px-3 py-2 text-sm font-medium">
      <TriangleAlert size={18} className="mt-0.5 shrink-0 text-a" />
      <span>{texto}</span>
    </div>
  )
}

function Contenido() {
  const { sesion } = useSesion()
  const [actual, setActual] = useState('inicio')

  useEffect(() => {
    // Con servidor, el periodo y los pagos fijos se generan tras sincronizar (useSesion) para no pisar datos del otro móvil.
    if (!sesion || relayDisponible()) return
    ;(async () => {
      await asegurarPeriodo()
      await generarRecurrentes()
    })()
  }, [sesion])

  useEffect(() => { scrollTo({ top: 0 }) }, [actual])

  if (!sesion) return <Acceso />
  const { Vista } = SECCIONES.find((s) => s.id === actual)!

  return (
    <>
      <main className="pb-seguro mx-auto max-w-lg px-4">
        <AvisoSync />
        <motion.div key={actual} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
          <Vista ir={setActual} />
        </motion.div>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-tinta/5 bg-superficie/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg">
        <ul className="mx-auto flex max-w-lg">
          {SECCIONES.map(({ id, texto, icono: I }) => {
            const activo = id === actual
            return (
              <li key={id} className="flex-1">
                <button onClick={() => { if (id !== actual) vibrar(8); setActual(id) }} aria-current={activo ? 'page' : undefined}
                  className={`relative flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${activo ? 'text-marca' : 'text-tinta/40'}`}>
                  {activo && <motion.span layoutId="pildora" className="absolute top-1.5 h-8 w-14 rounded-full bg-marca-suave" transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }} />}
                  <I size={22} className="relative" />
                  <span className="relative">{texto}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}

export default function App() {
  useTema()
  return <ProveedorToasts><ProveedorSesion><Contenido /></ProveedorSesion></ProveedorToasts>
}
