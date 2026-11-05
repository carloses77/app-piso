import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import QRCode from 'qrcode'
import { Settings, History, QrCode, RotateCw, Download, KeyRound, Trash2, Shield, Lock, Plus, Pencil, Minus, Cloud, CloudOff } from 'lucide-react'
import { db, type Historial } from '../db'
import { useAlias, useSesion } from '../hooks/useSesion'
import { useDatosPeriodo } from '../hooks/useDatos'
import { guardar, renovarPeriodo } from '../db/operaciones'
import { Avatar, Cabecera, Hoja, Segmentos, Vacio } from '../components/comunes'
import { calcularSaldo, eur } from '../logica/calculos'
import { borrarTodoLocal, cambiarClave, generarInvitacion } from '../cripto/sesion'
import { borrarHogarRemoto, relayDisponible } from '../sync/relay'
import { cifrarJSON } from '../cripto'
import Contadores from './Contadores'
import { useToast, useTema, type Tema } from '../hooks/useAvisos'
import { useAusencias } from '../hooks/useAjustes'
import { generarResumenPng, compartirImagen } from '../logica/resumen'
import { activarBiometria, biometriaActiva, biometriaDisponible, desactivarBiometria } from '../cripto/biometria'
import { abrirClaveHogarRaw } from '../cripto/sesion'
import { isoDia, mesActual, sumarDias, estaAusente } from '../logica/calculos'
import { useEffect } from 'react'
import { Fingerprint, Bell, Plane, ImageDown, SunMoon } from 'lucide-react'

const ICONO_ACCION = { crear: Plus, editar: Pencil, borrar: Minus }
const NOMBRE_ENTIDAD: Record<string, string> = { pagos: '💶 Pagos', extractos: '🏦 Banco', movimientos: '🧾 Movimientos',recurrentes: '🔁 Fijos', limpiezas: '🧽 Limpieza', tareas: '🛠️ Tareas', compra: '🛒 Compra', parking: '🚗 Parking', lecturas: '📈 Consumos', periodos: '📅 Periodos', ajustes: '⚙️ Ajustes' }

export default function Mas() {
  const [vista, setVista] = useState<'historial' | 'consumos' | 'ajustes'>('historial')
  return (
    <div>
      <Cabecera titulo="Más" icono={Settings} />
      <Segmentos valor={vista} cambiar={setVista} opciones={[{ valor: 'historial', texto: '📜 Histórico' }, { valor: 'consumos', texto: '📈 Consumos' }, { valor: 'ajustes', texto: '⚙️ Ajustes' }]} />
      {vista === 'historial' ? <HistorialVista /> : vista === 'consumos' ? <Contadores /> : <Ajustes />}
    </div>
  )
}

function HistorialVista() {
  const alias = useAlias()
  const [entidad, setEntidad] = useState('todas')
  const filas = useLiveQuery(() => db.historial.orderBy('fecha').reverse().limit(300).toArray(), []) ?? []
  const lista = filas.filter((h) => entidad === 'todas' || h.entidad === entidad)
  const porDia = lista.reduce<Record<string, Historial[]>>((acc, h) => {
    const k = new Date(h.fecha).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    ;(acc[k] ??= []).push(h)
    return acc
  }, {})
  return (
    <>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {['todas', ...Object.keys(NOMBRE_ENTIDAD)].map((e) => (
          <button key={e} onClick={() => setEntidad(e)}
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-semibold ${entidad === e ? 'bg-marca text-white' : 'bg-superficie'}`}>
            {e === 'todas' ? 'Todo' : NOMBRE_ENTIDAD[e]}
          </button>
        ))}
      </div>
      {lista.length === 0 && <Vacio icono={History} texto="Aún no hay operaciones" />}
      {Object.entries(porDia).map(([dia, hs]) => (
        <section key={dia} className="mb-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-tinta/45">{dia}</h2>
          <ol className="relative grid gap-2 border-l-2 border-marca/20 pl-4">
            {hs.map((h) => {
              const I = ICONO_ACCION[h.accion]
              return (
                <li key={h.id} className="tarjeta relative flex items-center gap-3 !p-3">
                  <span className="absolute -left-[27px] grid size-5 place-items-center rounded-full bg-marca text-white"><I size={12} /></span>
                  <Avatar u={h.usuario} nombre={alias[h.usuario]} tam={28} />
                  <span className="flex-1 text-sm">{h.resumen}</span>
                  <time className="text-xs text-tinta/40">{new Date(h.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</time>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </>
  )
}

function Ajustes() {
  const { sesion, bloquear, estadoSync } = useSesion()
  const alias = useAlias()
  const d = useDatosPeriodo()
  const periodos = useLiveQuery(() => db.periodos.orderBy('inicio').reverse().toArray(), []) ?? []
  const [hoja, setHoja] = useState<'' | 'qr' | 'clave' | 'bio' | 'ausente'>('')
  const toast = useToast()
  const [tema, setTema] = useTema()
  const ausencias = useAusencias()
  const [bio, setBio] = useState({ disponible: false, activa: false })
  const [aus, setAus] = useState({ desde: isoDia(), hasta: sumarDias(isoDia(), 7) })
  const [notif, setNotif] = useState(() => ('Notification' in window ? Notification.permission : 'denied'))
  useEffect(() => { (async () => setBio({ disponible: !!(await biometriaDisponible()), activa: await biometriaActiva() }))() }, [hoja])
  const [qr, setQr] = useState({ img: '', codigo: '' })
  const [c1, setC1] = useState('')
  const [c2, setC2] = useState('')
  const [msg, setMsg] = useState('')
  const yo = sesion!.rol

  async function invitar(e: React.FormEvent) {
    e.preventDefault()
    try {
      const codigo = await generarInvitacion(c1)
      const url = `${location.origin}${location.pathname}#emparejar=${codigo}`
      setQr({ img: await QRCode.toDataURL(url, { width: 280, margin: 1, color: { dark: '#1f1b3a' } }), codigo })
      setC1('')
      setMsg('')
    } catch (err) { setMsg((err as Error).message) }
  }

  async function cambiar(e: React.FormEvent) {
    e.preventDefault()
    if (c2.length < 6) return setMsg('La nueva clave debe tener al menos 6 caracteres')
    try {
      await cambiarClave(c1, c2)
      toast({ tipo: 'ok', texto: 'Clave cambiada' })
      setC1(''); setC2(''); setHoja('')
    } catch (err) { setMsg((err as Error).message) }
  }

  async function exportar() {
    const datos = Object.fromEntries(await Promise.all(['periodos', 'pagos', 'limpiezas', 'tareas', 'parking', 'ajustes', 'historial', 'extractos', 'movimientos', 'trozosPdf']
      .map(async (t) => [t, await db.table(t).toArray()])))
    const blob = new Blob([await cifrarJSON(sesion!.claveHogar, datos)], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `piso-backup-${new Date().toISOString().slice(0, 10)}.cifrado`
    a.click()
  }

  async function activarBio(e: React.FormEvent) {
    e.preventDefault()
    try {
      await activarBiometria(await abrirClaveHogarRaw(c1), alias[yo])
      toast({ tipo: 'ok', texto: 'Face ID / huella activado' })
      setC1(''); setMsg(''); setHoja('')
    } catch (err) { setMsg((err as Error).message) }
  }

  async function exportarResumen() {
    if (!d) return
    const mes = mesActual()
    const blob = await generarResumenPng({ mes, pagos: d.pagos, parking: d.parking, limpiezas: d.limpiezas, alias })
    await compartirImagen(blob, `resumen-piso-${mes}.png`)
  }

  async function pedirNotificaciones() {
    if (!('Notification' in window)) return toast({ tipo: 'error', texto: 'Instala la app en la pantalla de inicio para recibir avisos' })
    const r = await Notification.requestPermission()
    setNotif(r)
    toast({ tipo: r === 'granted' ? 'ok' : 'error', texto: r === 'granted' ? 'Avisos activados' : 'Avisos bloqueados en el sistema' })
  }

  async function guardarAusencia(e: React.FormEvent) {
    e.preventDefault()
    if (aus.hasta < aus.desde) return setMsg('La vuelta debe ser después de la salida')
    await guardar('ajustes', { id: `ausente-${yo}`, valor: JSON.stringify(aus) }, `${alias[yo]} estará fuera del ${aus.desde} al ${aus.hasta}`)
    toast({ tipo: 'ok', texto: '¡Buen viaje! Tu compi cubrirá la limpieza ✈️' })
    setMsg(''); setHoja('')
  }

  async function renovar() {
    if (!d) return
    const saldo = calcularSaldo(d.pagos, d.periodo?.saldoArrastrado)
    if (confirm(`¿Cerrar el periodo y abrir uno nuevo de 1 año?\nSe arrastrará un saldo de ${eur(saldo)} (positivo = ${alias.B} debe a ${alias.A}).`))
      await renovarPeriodo(saldo)
  }

  async function borrarTodo() {
    if (!confirm('Esto borra TODOS los datos de este móvil y del servidor. No se puede deshacer. ¿Seguro?')) return
    await borrarHogarRemoto(sesion!).catch(() => {})
    await borrarTodoLocal()
  }

  const Fila = ({ icono: I, texto, sub, onClick, peligro }: { icono: typeof Lock; texto: string; sub?: string; onClick: () => void; peligro?: boolean }) => (
    <button onClick={onClick} className={`flex min-h-14 w-full items-center gap-3 px-1 text-left ${peligro ? 'text-red-600' : ''}`}>
      <I size={20} className={peligro ? '' : 'text-marca'} />
      <span className="flex-1"><b className="text-sm">{texto}</b>{sub && <><br /><small className="text-tinta/50">{sub}</small></>}</span>
    </button>
  )

  return (
    <div className="grid gap-3">
      <section className="tarjeta flex items-center gap-3">
        <Avatar u={yo} nombre={alias[yo]} tam={44} />
        <input className="campo" defaultValue={alias[yo]} maxLength={20} aria-label="Tu apodo"
          onBlur={(e) => e.target.value.trim() && e.target.value !== alias[yo] && guardar('ajustes', { id: `alias-${yo}`, valor: e.target.value.trim() }, 'Apodo cambiado')} />
      </section>

      <section className="tarjeta divide-y divide-tinta/5 !py-1">
        <Fila icono={ImageDown} texto="Resumen del mes" sub="Infografía para compartir o guardar" onClick={exportarResumen} />
        <Fila icono={Plane} texto="Modo vacaciones"
          sub={ausencias[yo] && ausencias[yo]!.hasta >= isoDia() ? `Fuera del ${ausencias[yo]!.desde} al ${ausencias[yo]!.hasta}${estaAusente(ausencias[yo], isoDia()) ? ' · ahora' : ''}` : 'Tu compi cubre tus turnos de limpieza'}
          onClick={() => { setMsg(''); setHoja('ausente') }} />
        <Fila icono={Bell} texto="Avisos" sub={notif === 'granted' ? 'Activados: vencimientos y turnos' : 'Recordatorios de pagos y limpieza'} onClick={pedirNotificaciones} />
        <Fila icono={Fingerprint} texto="Face ID / huella"
          sub={bio.activa ? 'Activado · toca para desactivar' : bio.disponible ? 'Desbloquea sin escribir la clave' : 'No disponible en este dispositivo'}
          onClick={async () => {
            if (bio.activa) { await desactivarBiometria(); setBio({ ...bio, activa: false }); toast({ tipo: 'ok', texto: 'Biometría desactivada' }) }
            else if (bio.disponible) { setMsg(''); setC1(''); setHoja('bio') }
            else toast({ tipo: 'error', texto: 'Este dispositivo no tiene Face ID / huella compatible' })
          }} />
        <div className="flex min-h-14 items-center gap-3 px-1">
          <SunMoon size={20} className="text-marca" />
          <b className="flex-1 text-sm">Tema</b>
          <div className="flex rounded-xl bg-marca-suave p-0.5 text-xs font-bold">
            {(['auto', 'claro', 'oscuro'] as Tema[]).map((t) => (
              <button key={t} onClick={() => setTema(t)} className={`min-h-8 rounded-lg px-2.5 capitalize ${tema === t ? 'bg-superficie text-marca shadow' : 'text-tinta/50'}`}>{t}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="tarjeta">
        <h2 className="mb-2 flex items-center gap-2 font-bold">📅 Periodos</h2>
        {periodos.map((p) => (
          <div key={p.id} className="flex justify-between border-b border-tinta/5 py-2 text-sm last:border-0">
            <span>{new Date(p.inicio).toLocaleDateString('es-ES')} → {new Date(p.fin).toLocaleDateString('es-ES')}</span>
            <span className={`rounded-full px-2 text-xs font-bold ${p.activo ? 'bg-b/15 text-b' : 'bg-tinta/5 text-tinta/40'}`}>{p.activo ? 'Activo' : 'Cerrado'}</span>
          </div>
        ))}
        <button className="boton mt-2 w-full bg-marca-suave text-marca" onClick={renovar}><RotateCw size={18} /> Renovar 1 año</button>
      </section>

      <section className="tarjeta divide-y divide-tinta/5 !py-1">
        {yo === 'A' && <Fila icono={QrCode} texto="Invitar a mi compi" sub="QR válido 5 minutos · máx. 2 móviles" onClick={() => { setHoja('qr'); setQr({ img: '', codigo: '' }) }} />}
        <Fila icono={KeyRound} texto="Cambiar mi clave" onClick={() => setHoja('clave')} />
        <Fila icono={Download} texto="Exportar copia cifrada" sub="Solo se puede leer con la clave del piso" onClick={exportar} />
        <Fila icono={Lock} texto="Bloquear ahora" onClick={bloquear} />
        <Fila icono={relayDisponible() ? Cloud : CloudOff} texto="Sincronización"
          sub={relayDisponible() ? `Cifrada de extremo a extremo · ${estadoSync || '—'}` : 'Solo local (sin servidor configurado)'} onClick={() => {}} />
        <Fila icono={Shield} texto="Privacidad" sub="Sin datos personales ni rastreo" onClick={() => window.open('/privacidad.html', '_blank')} />
        <Fila icono={Trash2} texto="Borrar todos los datos" peligro onClick={borrarTodo} />
      </section>

      <Hoja abierta={hoja === 'qr'} cerrar={() => setHoja('')} titulo="Invitar a mi compi">
        {qr.img ? (
          <div className="grid justify-items-center gap-3 text-center">
            <img src={qr.img} alt="Código QR de invitación" className="rounded-2xl bg-superficie p-2" />
            <p className="text-sm text-tinta/60">Escanéalo con la cámara del otro móvil. Caduca en 5 minutos.</p>
            <button className="boton bg-superficie text-sm" onClick={() => navigator.clipboard?.writeText(qr.codigo)}>Copiar código</button>
          </div>
        ) : (
          <form onSubmit={invitar} className="grid gap-3">
            <p className="text-sm text-tinta/60">Confirma tu clave para generar la invitación.</p>
            <input className="campo" type="password" placeholder="Tu clave" value={c1} onChange={(e) => setC1(e.target.value)} autoFocus />
            {msg && <p className="text-sm text-red-600">{msg}</p>}
            <button className="boton bg-marca text-white">Generar QR</button>
          </form>
        )}
      </Hoja>

      <Hoja abierta={hoja === 'bio'} cerrar={() => { setHoja(''); setMsg('') }} titulo="Activar Face ID / huella">
        <form onSubmit={activarBio} className="grid gap-3">
          <p className="text-sm text-tinta/60">Confirma tu clave. Después el móvil te pedirá tu cara o huella.</p>
          <input className="campo" type="password" autoComplete="current-password" placeholder="Tu clave" value={c1} onChange={(e) => setC1(e.target.value)} autoFocus />
          {msg && <p className="text-sm text-red-500">{msg}</p>}
          <button className="boton min-h-13 bg-marca text-white"><Fingerprint size={18} /> Activar</button>
        </form>
      </Hoja>

      <Hoja abierta={hoja === 'ausente'} cerrar={() => { setHoja(''); setMsg('') }} titulo="Modo vacaciones ✈️">
        <form onSubmit={guardarAusencia} className="grid gap-3">
          <p className="text-sm text-tinta/60">Mientras estés fuera, las zonas de limpieza que te tocan pasan a {alias[yo === 'A' ? 'B' : 'A']}.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-tinta/60">Me voy<input className="campo mt-1" type="date" value={aus.desde} onChange={(e) => setAus({ ...aus, desde: e.target.value })} /></label>
            <label className="text-xs font-semibold text-tinta/60">Vuelvo<input className="campo mt-1" type="date" value={aus.hasta} onChange={(e) => setAus({ ...aus, hasta: e.target.value })} /></label>
          </div>
          {msg && <p className="text-sm text-red-500">{msg}</p>}
          <button className="boton min-h-13 bg-marca text-white">Guardar</button>
          {ausencias[yo] && (
            <button type="button" className="text-sm font-semibold text-red-500" onClick={async () => {
              await guardar('ajustes', { id: `ausente-${yo}`, valor: '' }, `${alias[yo]} ha vuelto`)
              toast({ tipo: 'ok', texto: '¡Bienvenido de vuelta!' }); setHoja('')
            }}>Ya he vuelto / cancelar</button>
          )}
        </form>
      </Hoja>

      <Hoja abierta={hoja === 'clave'} cerrar={() => { setHoja(''); setMsg('') }} titulo="Cambiar mi clave">
        <form onSubmit={cambiar} className="grid gap-3">
          <input className="campo" type="password" placeholder="Clave actual" value={c1} onChange={(e) => setC1(e.target.value)} />
          <input className="campo" type="password" placeholder="Nueva clave" value={c2} onChange={(e) => setC2(e.target.value)} />
          {msg && <p className="text-sm">{msg}</p>}
          <button className="boton bg-marca text-white">Guardar</button>
        </form>
      </Hoja>
    </div>
  )
}
