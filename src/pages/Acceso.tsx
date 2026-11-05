import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Lock, Home, UserPlus, ShieldCheck, Copy, Eye, EyeOff, ArrowLeft, Fingerprint, KeyRound, LifeBuoy, Check } from 'lucide-react'
import {
  crearHogar, desbloquear, estaConfigurado, unirseConInvitacion, leerInvitacion, generarClaveInicial,
  normalizarClaveInicial, recuperarConClaveInicial, sesionDesdeRaw, borrarTodoLocal, abrirClaveHogarRaw,
} from '../cripto/sesion'
import { activarBiometria, biometriaActiva, biometriaDisponible, desbloquearConBiometria } from '../cripto/biometria'
import type { Sesion } from '../cripto/sesion'
import { registrarDispositivo } from '../sync/relay'
import { useSesion } from '../hooks/useSesion'
import { useToast, vibrar } from '../hooks/useAvisos'
import { guardar, fijarUsuario, asegurarPeriodo } from '../db/operaciones'
import { leerConfig } from '../db'

type Paso = 'cargando' | 'bienvenida' | 'invitacion' | 'claveInicial' | 'confirmar' | 'perfil' | 'bloqueo' | 'recuperar' | 'ofrecerBio'
const PASOS_ALTA: Paso[] = ['claveInicial', 'confirmar', 'perfil']

function fuerza(c: string) {
  let p = 0
  if (c.length >= 8) p++
  if (c.length >= 12) p++
  if (/[a-z]/.test(c) && /[A-Z]/.test(c)) p++
  if (/\d/.test(c)) p++
  if (/[^A-Za-z0-9]/.test(c)) p++
  return Math.min(p, 4)
}
const NIVELES = [
  { txt: 'Muy débil', color: '#ef4444' }, { txt: 'Débil', color: '#f97316' }, { txt: 'Aceptable', color: '#eab308' },
  { txt: 'Buena', color: '#22c55e' }, { txt: 'Muy buena', color: '#18b98d' },
]

function CampoClave({ valor, cambiar, placeholder, nueva, autoFocus, medidor }: {
  valor: string; cambiar: (v: string) => void; placeholder: string; nueva?: boolean; autoFocus?: boolean; medidor?: boolean
}) {
  const [ver, setVer] = useState(false)
  const f = fuerza(valor)
  return (
    <div>
      <div className="relative">
        <input className="campo pr-12" type={ver ? 'text' : 'password'} autoComplete={nueva ? 'new-password' : 'current-password'}
          placeholder={placeholder} value={valor} onChange={(e) => cambiar(e.target.value)} autoFocus={autoFocus} />
        <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? 'Ocultar clave' : 'Mostrar clave'}
          className="absolute top-0 right-0 grid size-12 place-items-center text-tinta/40">{ver ? <EyeOff size={20} /> : <Eye size={20} />}</button>
      </div>
      {medidor && valor && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex flex-1 gap-1">
            {[0, 1, 2, 3].map((i) => <span key={i} className="h-1.5 flex-1 rounded-full transition-colors" style={{ background: i < f ? NIVELES[f].color : 'color-mix(in srgb, var(--tinta) 10%, transparent)' }} />)}
          </div>
          <span className="text-xs font-semibold" style={{ color: NIVELES[f].color }}>{NIVELES[f].txt}</span>
        </div>
      )}
    </div>
  )
}

export default function Acceso() {
  const { entrar } = useSesion()
  const toast = useToast()
  const [paso, setPaso] = useState<Paso>('cargando')
  const [modo, setModo] = useState<'crear' | 'unirse'>('crear')
  const [rolUnion, setRolUnion] = useState<'A' | 'B'>('B')
  const [clave, setClave] = useState('')
  const [clave2, setClave2] = useState('')
  const [alias, setAlias] = useState('')
  const [aliasGuardado, setAliasGuardado] = useState('')
  const [codigo, setCodigo] = useState(() => new URLSearchParams(location.hash.slice(1)).get('emparejar') ?? '')
  const [claveInicial, setClaveInicial] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [guardada, setGuardada] = useState(false)
  const [conBio, setConBio] = useState(false)
  const [pendiente, setPendiente] = useState<{ s: Sesion; clave: string; alias: string }>()
  const autoBio = useRef(false)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    (async () => {
      if (await estaConfigurado()) {
        setConBio(await biometriaActiva())
        const yo = await leerConfig('rol')
        const fila = yo ? await import('../db').then(({ db }) => db.ajustes.get(`alias-${yo}`)) : undefined
        setAliasGuardado(fila?.valor ?? '')
        setPaso('bloqueo')
      } else if (codigo) {
        setModo('unirse')
        setPaso('invitacion')
      } else setPaso('bienvenida')
    })()
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ir = (p: Paso) => { setError(''); setPaso(p) }

  /** Tras entrar con la clave, propone activar Face ID / huella si el móvil lo permite y aún no está activo. */
  async function entrarOfreciendoBio(s: Sesion, clavePlano: string, nombre: string) {
    let noPreguntar = false
    try { noPreguntar = localStorage.getItem('bio-no-preguntar') === '1' } catch { /* sin storage */ }
    if (!noPreguntar && (await biometriaDisponible()) && !(await biometriaActiva())) {
      setPendiente({ s, clave: clavePlano, alias: nombre || 'PisoCompartido' })
      setClave(''); setClave2('')
      return ir('ofrecerBio')
    }
    entrar(s)
  }

  async function activarYEntrar() {
    if (!pendiente) return
    setOcupado(true)
    try {
      await activarBiometria(await abrirClaveHogarRaw(pendiente.clave), pendiente.alias)
      toast({ tipo: 'ok', texto: 'Listo: la próxima vez entra con tu cara o huella' })
    } catch (err) {
      toast({ tipo: 'error', texto: (err as Error).message === 'Cancelado' ? 'Activación cancelada' : `${(err as Error).message}. Usa el autorrelleno de contraseñas del móvil.` })
    } finally {
      setOcupado(false)
      const s = pendiente.s
      setPendiente(undefined)
      entrar(s)
    }
  }
  const fallo = (msg: string) => { setError(msg); vibrar([20, 40, 20]) }

  function empezarAlta(m: 'crear' | 'unirse') {
    setModo(m)
    setClaveInicial(generarClaveInicial())
    setGuardada(false)
    setConfirmacion('')
    ir(m === 'unirse' && !codigo ? 'invitacion' : 'claveInicial')
  }

  async function terminarAlta(e: React.FormEvent) {
    e.preventDefault()
    if (clave.length < 8) return fallo('La clave debe tener al menos 8 caracteres')
    if (clave !== clave2) return fallo('Las claves no coinciden')
    if (!alias.trim()) return fallo('Elige un apodo para que tu compi te reconozca')
    setOcupado(true)
    try {
      const s = modo === 'crear' ? await crearHogar(clave, claveInicial) : await unirseConInvitacion(codigo, clave, claveInicial, rolUnion)
      await registrarDispositivo(s)
      fijarUsuario(s.rol)
      await guardar('ajustes', { id: `alias-${s.rol}`, valor: alias.trim().slice(0, 20) }, 'Alias definido')
      if (modo === 'crear') await asegurarPeriodo()
      history.replaceState(null, '', location.pathname)
      vibrar([15, 50, 15])
      await entrarOfreciendoBio(s, clave, alias.trim())
    } catch (err) {
      fallo((err as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  async function abrir(e: React.FormEvent) {
    e.preventDefault()
    if (!clave) return
    setOcupado(true)
    try { await entrarOfreciendoBio(await desbloquear(clave), clave, aliasGuardado) } catch (err) { fallo((err as Error).message); setClave('') } finally { setOcupado(false) }
  }

  async function abrirBio(automatico = false) {
    setError('')
    try { entrar(await sesionDesdeRaw(await desbloquearConBiometria())) } catch (err) {
      // al lanzarse sola, una cancelación o un bloqueo del navegador no es un error para el usuario
      if (!automatico) fallo((err as Error).message)
    }
  }

  // Lanza Face ID / huella sola al abrir o al volver a la app (se bloquea al pasar a segundo plano)
  useEffect(() => {
    if (paso !== 'bloqueo' || !conBio) return
    const intentar = () => {
      if (document.hidden || autoBio.current) return
      autoBio.current = true
      abrirBio(true)
    }
    intentar()
    document.addEventListener('visibilitychange', intentar)
    return () => document.removeEventListener('visibilitychange', intentar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, conBio])

  async function recuperar(e: React.FormEvent) {
    e.preventDefault()
    if (clave.length < 8) return fallo('La nueva clave debe tener al menos 8 caracteres')
    if (clave !== clave2) return fallo('Las claves no coinciden')
    setOcupado(true)
    try {
      const s = await recuperarConClaveInicial(confirmacion, clave)
      toast({ tipo: 'ok', texto: 'Clave cambiada. ¡Bienvenido de nuevo!' })
      await entrarOfreciendoBio(s, clave, aliasGuardado)
    } catch (err) { fallo((err as Error).message) } finally { setOcupado(false) }
  }

  if (paso === 'cargando') return null
  const idxAlta = PASOS_ALTA.indexOf(paso)

  return (
    <main className="pt-seguro mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 pb-8">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}
        className="mb-6 flex flex-col items-center text-center">
        <img src="/icono.svg" alt="" className="mb-3 size-20 drop-shadow-xl" />
        <h1 className="text-3xl font-extrabold">PisoCompartido</h1>
        <p className="text-sm text-tinta/55">{paso === 'bloqueo' && aliasGuardado ? `Hola de nuevo, ${aliasGuardado} 👋` : 'Gastos, limpieza y parking entre dos'}</p>
      </motion.div>

      {idxAlta >= 0 && (
        <div className="mb-4 flex justify-center gap-2" aria-label={`Paso ${idxAlta + 1} de 3`}>
          {PASOS_ALTA.map((p, i) => <span key={p} className={`h-2 rounded-full transition-all duration-300 ${i <= idxAlta ? 'w-8 bg-marca' : 'w-2 bg-tinta/15'}`} />)}
        </div>
      )}

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={paso} className="w-full" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
          {paso === 'bienvenida' && (
            <div className="grid gap-3">
              <button className="tarjeta flex items-center gap-4 text-left transition-transform active:scale-[.98]" onClick={() => empezarAlta('crear')}>
                <span className="grid size-12 place-items-center rounded-2xl bg-marca text-white"><Home /></span>
                <span><b>Crear el piso</b><br /><small className="text-tinta/50">Soy el primero en instalarla</small></span>
              </button>
              <button className="tarjeta flex items-center gap-4 text-left transition-transform active:scale-[.98]" onClick={() => empezarAlta('unirse')}>
                <span className="grid size-12 place-items-center rounded-2xl bg-b text-white"><UserPlus /></span>
                <span><b>Unirme con invitación</b><br /><small className="text-tinta/50">Escanea el QR del móvil de tu compi</small></span>
              </button>
            </div>
          )}

          {paso === 'invitacion' && (
            <form className="tarjeta grid gap-3" onSubmit={(e) => {
              e.preventDefault()
              try { leerInvitacion(codigo); setClaveInicial(generarClaveInicial()); ir('claveInicial') } catch (err) { fallo((err as Error).message) }
            }}>
              <h2 className="flex items-center gap-2 text-lg font-bold"><UserPlus size={20} /> Código de invitación</h2>
              <p className="text-sm text-tinta/60">Tu compi lo genera en <b>Más → Ajustes → Invitar</b>. Si escaneas el QR con la cámara se rellena solo.</p>
              <textarea className="campo min-h-24 py-2 font-mono text-xs" placeholder="Pega aquí el código" value={codigo} onChange={(e) => setCodigo(e.target.value)} required />
              {error && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
              <button className="boton min-h-13 bg-marca text-white">Continuar</button>
              <button type="button" className="text-sm text-tinta/50" onClick={() => ir('bienvenida')}>Volver</button>
            </form>
          )}

          {paso === 'claveInicial' && (
            <div className="tarjeta grid gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold"><KeyRound size={20} /> Tu clave inicial</h2>
              <p className="text-sm text-tinta/60">Apúntala en un lugar seguro (papel o gestor de contraseñas). La necesitarás ahora para crear tu usuario y <b>más adelante si olvidas tu clave</b>. Solo la ves tú.</p>
              <div className="rounded-2xl border-2 border-dashed border-marca/40 bg-marca-suave p-4 text-center font-mono text-xl font-bold tracking-wider text-marca select-all">{claveInicial}</div>
              <button type="button" className="boton bg-superficie ring-1 ring-tinta/10" onClick={async () => {
                try { await navigator.clipboard.writeText(claveInicial); toast({ tipo: 'ok', texto: 'Copiada. Guárdala fuera de esta app.' }) } catch { toast({ tipo: 'error', texto: 'No se pudo copiar; apúntala a mano' }) }
              }}><Copy size={18} /> Copiar</button>
              <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
                <input type="checkbox" className="size-5 accent-marca" checked={guardada} onChange={(e) => setGuardada(e.target.checked)} /> Ya la he guardado
              </label>
              <button className="boton min-h-13 bg-marca text-white disabled:opacity-40" disabled={!guardada} onClick={() => ir('confirmar')}>Continuar</button>
              <button type="button" className="text-sm text-tinta/50" onClick={() => ir('bienvenida')}>Cancelar</button>
            </div>
          )}

          {paso === 'confirmar' && (
            <form className="tarjeta grid gap-3" onSubmit={(e) => {
              e.preventDefault()
              if (normalizarClaveInicial(confirmacion) !== normalizarClaveInicial(claveInicial)) return fallo('No coincide. Revisa la clave que apuntaste.')
              ir('perfil')
            }}>
              <h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck size={20} /> Introduce la clave inicial</h2>
              <p className="text-sm text-tinta/60">Escríbela para confirmar que la tienes bien apuntada.</p>
              <input className="campo text-center font-mono text-lg tracking-wider uppercase" placeholder="XXXX-XXXX-XXXX-XXXX" value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} autoFocus />
              {error && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
              <button className="boton min-h-13 bg-marca text-white">Comprobar</button>
              <button type="button" className="flex items-center justify-center gap-1 text-sm text-tinta/50" onClick={() => ir('claveInicial')}><ArrowLeft size={14} /> Ver la clave otra vez</button>
            </form>
          )}

          {paso === 'perfil' && (
            <form className="tarjeta grid gap-3" onSubmit={terminarAlta}>
              <h2 className="flex items-center gap-2 text-lg font-bold"><Lock size={20} /> Crea tu usuario</h2>
              {modo === 'unirse' && (
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-sm text-tinta/60">¿Quién eres en este piso? Si ya usabas la app, elige lo mismo que antes.</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {([['A', 'Creé el piso'], ['B', 'Me invitaron']] as const).map(([r, texto]) => (
                      <button key={r} type="button" aria-pressed={rolUnion === r} onClick={() => setRolUnion(r)}
                        className={`boton text-sm ${rolUnion === r ? 'bg-marca text-white' : 'bg-superficie ring-1 ring-tinta/10'}`}>{texto}</button>
                    ))}
                  </div>
                </fieldset>
              )}
              <input className="campo" name="username" autoComplete="username" placeholder="Tu apodo (sin datos reales)" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={20} autoFocus />
              <CampoClave valor={clave} cambiar={setClave} placeholder="Clave definitiva (mín. 8)" nueva medidor />
              <CampoClave valor={clave2} cambiar={setClave2} placeholder="Repite la clave" nueva />
              {error && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
              <button className="boton min-h-13 bg-marca text-white disabled:opacity-60" disabled={ocupado}>{ocupado ? 'Cifrando…' : <><Check size={18} /> Crear mi usuario</>}</button>
              <p className="flex gap-2 text-xs text-tinta/50"><ShieldCheck size={16} className="shrink-0" />
                Tu clave nunca sale de este móvil y tu compi no puede verla. Tu navegador puede recordarla por ti.</p>
            </form>
          )}

          {paso === 'bloqueo' && (
            <div className="grid gap-3">
              {conBio && (
                <button className="tarjeta flex items-center justify-center gap-3 font-bold text-marca transition-transform active:scale-[.98]" onClick={() => abrirBio()}>
                  <Fingerprint size={26} /> Entrar con Face ID / huella
                </button>
              )}
              <form onSubmit={abrir} className="tarjeta grid gap-3">
                <h2 className="flex items-center gap-2 text-lg font-bold"><Lock size={20} /> Introduce tu clave</h2>
                {/* usuario oculto para que el llavero/gestor asocie y recuerde la contraseña */}
                <input type="text" name="username" autoComplete="username" value={aliasGuardado || 'PisoCompartido'} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
                <CampoClave valor={clave} cambiar={setClave} placeholder="Clave personal" autoFocus={!conBio} />
                {error && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
                <button className="boton min-h-13 bg-marca text-white disabled:opacity-60" disabled={ocupado}>{ocupado ? 'Comprobando…' : 'Desbloquear'}</button>
                <button type="button" className="flex items-center justify-center gap-1.5 text-sm font-semibold text-marca" onClick={() => { setClave(''); setClave2(''); setConfirmacion(''); ir('recuperar') }}>
                  <LifeBuoy size={16} /> ¿Olvidaste tu clave?
                </button>
              </form>
            </div>
          )}

          {paso === 'ofrecerBio' && (
            <div className="tarjeta grid gap-3 text-center">
              <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
                className="mx-auto grid size-20 place-items-center rounded-3xl bg-marca-suave text-marca"><Fingerprint size={44} /></motion.span>
              <h2 className="text-xl font-extrabold">¿Entrar con Face ID o huella?</h2>
              <p className="text-sm text-tinta/60">Así no tendrás que escribir la clave cada vez. Tu cara o huella nunca salen del móvil.</p>
              <button className="boton min-h-13 bg-marca text-white disabled:opacity-60" disabled={ocupado} onClick={activarYEntrar}>
                <Fingerprint size={20} /> {ocupado ? 'Esperando al móvil…' : 'Activar ahora'}
              </button>
              <button className="boton bg-superficie ring-1 ring-tinta/10" onClick={() => { const s = pendiente!.s; setPendiente(undefined); entrar(s) }}>Ahora no</button>
              <button className="text-xs text-tinta/45" onClick={() => {
                try { localStorage.setItem('bio-no-preguntar', '1') } catch { /* sin storage */ }
                const s = pendiente!.s; setPendiente(undefined); entrar(s)
              }}>No volver a preguntar</button>
            </div>
          )}

          {paso === 'recuperar' && (
            <form onSubmit={recuperar} className="tarjeta grid gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold"><LifeBuoy size={20} /> Recuperar acceso</h2>
              <p className="text-sm text-tinta/60">Introduce la <b>clave inicial</b> que apuntaste al crear tu usuario y elige una clave nueva.</p>
              <input className="campo text-center font-mono text-lg tracking-wider uppercase" placeholder="XXXX-XXXX-XXXX-XXXX" value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} autoFocus />
              <input type="text" name="username" autoComplete="username" value={aliasGuardado || 'PisoCompartido'} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
              <CampoClave valor={clave} cambiar={setClave} placeholder="Nueva clave (mín. 8)" nueva medidor />
              <CampoClave valor={clave2} cambiar={setClave2} placeholder="Repite la nueva clave" nueva />
              {error && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
              <button className="boton min-h-13 bg-marca text-white disabled:opacity-60" disabled={ocupado}>{ocupado ? 'Comprobando…' : 'Cambiar clave y entrar'}</button>
              <button type="button" className="text-sm text-tinta/50" onClick={() => ir('bloqueo')}>Volver</button>
              <details className="text-xs text-tinta/50">
                <summary className="cursor-pointer font-semibold">¿Tampoco tienes la clave inicial?</summary>
                <p className="mt-2">Nadie puede recuperar los datos cifrados sin ella. Puedes borrar este móvil y volver a unirte con un QR de tu compi; los datos compartidos se descargarán de nuevo.</p>
                <button type="button" className="mt-2 font-bold text-red-500" onClick={() => confirm('¿Borrar todos los datos de ESTE móvil y empezar de cero?') && borrarTodoLocal()}>Borrar este móvil y empezar de cero</button>
              </details>
            </form>
          )}
        </motion.div>
      </AnimatePresence>
    </main>
  )
}
