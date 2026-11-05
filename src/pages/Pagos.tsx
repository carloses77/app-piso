import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Wallet, Plus, Check, Trash2, Receipt, Camera, Repeat, X, ImageIcon, Pause, Play, ScanLine, Images } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDatosPeriodo } from '../hooks/useDatos'
import { pausarBloqueo, reanudarBloqueo, useAlias, useSesion } from '../hooks/useSesion'
import { useToast } from '../hooks/useAvisos'
import { guardar, borrar } from '../db/operaciones'
import { Avatar, Cabecera, Hoja, ICONO_PAGO, Segmentos, Vacio } from '../components/comunes'
import HojaTicket, { type TicketRevisado } from '../components/HojaTicket'
import { eur, isoDia } from '../logica/calculos'
import { comprimirFoto } from '../logica/imagen'
import { aNumero, sumaLineas, type LineaTicket } from '../logica/ticket'
import { db, type Pago, type TipoPago, type Usuario } from '../db'

type Vista = 'pendientes' | 'todos' | 'fijos'

export default function Pagos() {
  const d = useDatosPeriodo()
  const alias = useAlias()
  const { sesion } = useSesion()
  const toast = useToast()
  const recurrentes = useLiveQuery(() => db.recurrentes.filter((r) => !r.borrado).toArray(), []) ?? []
  const [abierta, setAbierta] = useState(false)
  const [verTicket, setVerTicket] = useState<Pago>()
  const [archivoTicket, setArchivoTicket] = useState<File>()
  const [vista, setVista] = useState<Vista>('pendientes')
  const inicial = { tipo: 'renta' as TipoPago, concepto: '', importe: '', fecha: isoDia(), pagadoPor: sesion!.rol as Usuario, parte: 50, foto: '', repetir: false, lineasTicket: [] as LineaTicket[], totalTicket: undefined as number | undefined }
  const [f, setF] = useState(inicial)
  const fotoRef = useRef<HTMLInputElement>(null)
  const camaraTicketRef = useRef<HTMLInputElement>(null)
  const galeriaTicketRef = useRef<HTMLInputElement>(null)

  if (!d) return null
  const lista = d.pagos.filter((p) => vista === 'todos' || !p.saldado).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const pendiente = d.pagos.filter((p) => !p.saldado).reduce((s, p) => s + p.importe * (1 - p.partePagador / 100), 0)

  async function elegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    if (!archivo) return
    try { setF((x) => ({ ...x, foto: '' })); const foto = await comprimirFoto(archivo); setF((x) => ({ ...x, foto })) }
    catch { toast({ tipo: 'error', texto: 'No se pudo leer la foto' }) }
  }

  // La cámara manda la app a segundo plano: sin esta pausa se bloquearía y se perdería el ticket.
  function abrirSelector(entrada: HTMLInputElement | null) {
    pausarBloqueo(2 * 60_000)
    entrada?.click()
  }

  function elegirTicket(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return reanudarBloqueo()
    pausarBloqueo(10 * 60_000)
    setAbierta(false)
    setArchivoTicket(archivo)
  }

  function aplicarTicket(t: TicketRevisado) {
    setF((x) => ({
      ...x, tipo: 'otro', concepto: t.concepto, fecha: t.fecha ?? x.fecha, foto: t.foto, lineasTicket: t.lineas, totalTicket: t.total,
      importe: sumaLineas(t.lineas).toFixed(2).replace('.', ','),
    }))
    setArchivoTicket(undefined)
    setAbierta(true)
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    const importe = aNumero(f.importe)
    // Si se cambia el importe a mano, el detalle ya no explicaría ese gasto.
    const conDetalle = f.lineasTicket.length > 0 && sumaLineas(f.lineasTicket) === importe
    if (!d?.periodo || !(importe > 0)) return toast({ tipo: 'error', texto: 'Pon un importe válido' })
    const concepto = f.concepto.trim() || ICONO_PAGO[f.tipo].nombre
    let recurrenteId: string | undefined
    if (f.repetir) {
      recurrenteId = await guardar('recurrentes', {
        tipo: f.tipo, concepto, importe, dia: Number(f.fecha.slice(8)), pagadoPor: f.pagadoPor, partePagador: f.parte, activo: true,
      }, `Pago fijo mensual creado: ${concepto}`)
    }
    const id = await guardar('pagos', {
      ...(recurrenteId ? { id: `rec-${recurrenteId}-${f.fecha.slice(0, 7)}`, recurrenteId } : {}),
      periodoId: d.periodo.id, tipo: f.tipo, concepto, importe, fecha: f.fecha, pagadoPor: f.pagadoPor,
      partePagador: f.parte, saldado: false, ...(f.foto ? { foto: f.foto } : {}),
      ...(conDetalle ? { lineasTicket: f.lineasTicket, ...(f.totalTicket !== undefined ? { totalTicket: f.totalTicket } : {}) } : {}),
    }, `Pago ${concepto} ${eur(importe)} por ${alias[f.pagadoPor]}`)
    setAbierta(false)
    setF(inicial)
    toast({ tipo: 'ok', texto: `${concepto} · ${eur(importe)} guardado`, deshacer: () => borrar('pagos', id, `Deshecho: ${concepto}`) })
  }

  async function saldar(p: Pago) {
    await guardar('pagos', { ...p, saldado: true }, `Saldado: ${p.concepto}`)
    toast({ tipo: 'ok', texto: `${p.concepto} saldado 🎉`, deshacer: () => guardar('pagos', { ...p, saldado: false }, `Reabierto: ${p.concepto}`) })
  }

  async function quitar(p: Pago) {
    await borrar('pagos', p.id, `Borrado: ${p.concepto} ${eur(p.importe)}`)
    toast({ tipo: 'ok', texto: 'Pago borrado', deshacer: () => guardar('pagos', { ...p, borrado: false }, `Restaurado: ${p.concepto}`) })
  }

  return (
    <div>
      <Cabecera titulo="Pagos" icono={Wallet} extra={
        <button className="boton bg-marca-suave text-marca" disabled={!d.periodo} onClick={() => abrirSelector(camaraTicketRef.current)}><ScanLine size={18} /> Ticket</button>
      } />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="tarjeta !p-3">
          <div className="text-xs text-tinta/50">Pendiente de saldar</div>
          <div className="text-xl font-extrabold tabular-nums">{eur(pendiente)}</div>
        </div>
        <div className="tarjeta !p-3">
          <div className="text-xs text-tinta/50">Pagos fijos activos</div>
          <div className="text-xl font-extrabold">{recurrentes.filter((r) => r.activo).length}</div>
        </div>
      </div>

      <Segmentos valor={vista} cambiar={setVista} opciones={[
        { valor: 'pendientes', texto: 'Pendientes' }, { valor: 'todos', texto: 'Todos' }, { valor: 'fijos', texto: '🔁 Fijos' }]} />

      {vista === 'fijos' ? (
        recurrentes.length === 0 ? <Vacio icono={Repeat} texto="Al crear un pago, marca «Repetir cada mes» y se generará solo." /> : (
          <ul className="grid gap-2">
            {recurrentes.map((r) => {
              const info = ICONO_PAGO[r.tipo]
              return (
                <li key={r.id} className={`tarjeta flex items-center gap-3 !p-3 ${r.activo ? '' : 'opacity-50'}`}>
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl" style={{ background: info.color + '1f', color: info.color }}><info.icono size={22} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{r.concepto}</div>
                    <div className="text-xs text-tinta/50">Día {r.dia} de cada mes · paga {alias[r.pagadoPor]}</div>
                  </div>
                  <b className="tabular-nums">{eur(r.importe)}</b>
                  <button aria-label={r.activo ? 'Pausar' : 'Reanudar'} className="boton size-10 bg-marca-suave p-0 text-marca"
                    onClick={() => guardar('recurrentes', { ...r, activo: !r.activo }, `Pago fijo ${r.activo ? 'pausado' : 'reanudado'}: ${r.concepto}`)}>
                    {r.activo ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button aria-label="Eliminar pago fijo" className="boton size-10 p-0 text-tinta/30"
                    onClick={() => confirm(`¿Dejar de generar «${r.concepto}»?`) && borrar('recurrentes', r.id, `Pago fijo eliminado: ${r.concepto}`)}><Trash2 size={18} /></button>
                </li>
              )
            })}
          </ul>
        )
      ) : lista.length === 0 ? <Vacio icono={Receipt} texto={vista === 'pendientes' ? '¡Todo saldado! No hay pagos pendientes.' : 'Aún no hay pagos. Pulsa + para añadir el primero.'} /> : (
        <ul className="grid gap-2">
          <AnimatePresence initial={false}>
            {lista.map((p) => {
              const info = ICONO_PAGO[p.tipo]
              const deuda = p.importe * (1 - p.partePagador / 100)
              const otro = p.pagadoPor === 'A' ? 'B' : 'A'
              return (
                <motion.li key={p.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -40, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.18 }} className={`tarjeta flex items-center gap-3 !p-3 ${p.saldado ? 'opacity-55' : ''}`}>
                  <button className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl" style={{ background: info.color + '1f', color: info.color }}
                    onClick={() => p.foto && setVerTicket(p)} aria-label={p.foto ? 'Ver ticket' : info.nombre}>
                    {p.foto ? <img src={p.foto} alt="" className="size-full object-cover" /> : <info.icono size={22} />}
                    {p.recurrenteId && <Repeat size={11} className="absolute right-0.5 bottom-0.5 rounded-full bg-superficie p-0.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{p.concepto}</div>
                    <div className="flex flex-wrap items-center gap-1 text-xs text-tinta/50">
                      <Avatar u={p.pagadoPor} nombre={alias[p.pagadoPor]} tam={16} />
                      {new Date(p.fecha + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                      {p.lineasTicket && <span>{p.lineasTicket.length} {p.lineasTicket.length === 1 ? 'línea' : 'líneas'} del ticket</span>}
                      {!p.saldado && deuda > 0 && <span className="rounded-full bg-a/15 px-1.5 font-semibold text-a">{alias[otro]} debe {eur(deuda)}</span>}
                    </div>
                  </div>
                  <b className="tabular-nums">{eur(p.importe)}</b>
                  {!p.saldado && <button aria-label="Marcar saldado" className="boton size-10 bg-b/15 p-0 text-b" onClick={() => saldar(p)}><Check size={18} /></button>}
                  <button aria-label="Borrar pago" className="boton size-10 p-0 text-tinta/30" onClick={() => quitar(p)}><Trash2 size={18} /></button>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}

      {/* Botón flotante */}
      <motion.button whileTap={{ scale: 0.92 }} onClick={() => setAbierta(true)} disabled={!d.periodo} aria-label="Nuevo pago"
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-30 grid size-16 place-items-center rounded-full bg-marca text-white shadow-xl shadow-marca/40 disabled:opacity-40">
        <Plus size={30} />
      </motion.button>

      <Hoja abierta={abierta} cerrar={() => setAbierta(false)} titulo="Nuevo pago">
        <form onSubmit={crear} className="grid gap-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button type="button" className="boton bg-marca-suave text-marca" onClick={() => abrirSelector(camaraTicketRef.current)}><ScanLine size={18} /> Escanear ticket</button>
            <button type="button" className="boton size-11 bg-marca-suave p-0 text-marca" aria-label="Elegir ticket de la galería" onClick={() => abrirSelector(galeriaTicketRef.current)}><Images size={18} /></button>
          </div>
          <div className="sin-barra -mx-5 flex gap-2 overflow-x-auto px-5">
            {(Object.keys(ICONO_PAGO) as TipoPago[]).map((t) => {
              const info = ICONO_PAGO[t]
              const sel = f.tipo === t
              return (
                <button type="button" key={t} onClick={() => setF({ ...f, tipo: t })} aria-pressed={sel}
                  className="flex min-w-[72px] flex-col items-center gap-1 rounded-2xl border-2 bg-superficie py-2 text-xs font-semibold transition-colors"
                  style={{ borderColor: sel ? info.color : 'transparent', color: sel ? info.color : undefined }}>
                  <info.icono size={22} style={{ color: info.color }} />{info.nombre}
                </button>
              )
            })}
          </div>
          <div className="relative">
            <input className="campo !min-h-16 pr-10 text-center text-3xl font-extrabold" inputMode="decimal" placeholder="0,00" value={f.importe}
              onChange={(e) => setF({ ...f, importe: e.target.value.replace(/[^\d.,]/g, '') })} required />
            <span className="absolute top-1/2 right-4 -translate-y-1/2 text-2xl font-bold text-tinta/30">€</span>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input className="campo" placeholder={`Concepto (${ICONO_PAGO[f.tipo].nombre})`} value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} maxLength={40} />
            <input className="campo !w-auto" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} aria-label="Fecha" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['A', 'B'] as const).map((u) => (
              <button type="button" key={u} onClick={() => setF({ ...f, pagadoPor: u })} aria-pressed={f.pagadoPor === u}
                className={`boton border-2 bg-superficie ${f.pagadoPor === u ? 'border-marca' : 'border-transparent'}`}>
                <Avatar u={u} nombre={alias[u]} tam={26} /> Pagó {alias[u]}
              </button>
            ))}
          </div>
          <div className="rounded-2xl bg-superficie p-3">
            <div className="mb-2 flex text-sm font-semibold">
              <span className="flex-1" style={{ color: f.pagadoPor === 'A' ? 'var(--color-a)' : 'var(--color-b)' }}>{alias[f.pagadoPor]} {f.parte}%</span>
              <span style={{ color: f.pagadoPor === 'A' ? 'var(--color-b)' : 'var(--color-a)' }}>{alias[f.pagadoPor === 'A' ? 'B' : 'A']} {100 - f.parte}%</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={f.parte} onChange={(e) => setF({ ...f, parte: Number(e.target.value) })} className="w-full accent-marca" aria-label="Reparto" />
            <div className="mt-2 flex gap-2">
              {[50, 100, 0].map((v) => (
                <button type="button" key={v} onClick={() => setF({ ...f, parte: v })}
                  className={`flex-1 rounded-xl py-1.5 text-xs font-bold ${f.parte === v ? 'bg-marca text-white' : 'bg-marca-suave text-marca'}`}>
                  {v === 50 ? 'A medias' : v === 100 ? 'Solo quien paga' : 'Todo el otro'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => abrirSelector(fotoRef.current)} className={`boton bg-superficie ${f.foto ? 'text-b' : ''}`}>
              {f.foto ? <><ImageIcon size={18} /> Ticket listo</> : <><Camera size={18} /> Foto ticket</>}
            </button>
            <button type="button" onClick={() => setF({ ...f, repetir: !f.repetir })} aria-pressed={f.repetir}
              className={`boton ${f.repetir ? 'bg-marca text-white' : 'bg-superficie'}`}><Repeat size={18} /> Cada mes</button>
          </div>
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={elegirFoto} />
          <button className="boton min-h-13 bg-marca text-lg text-white">Guardar pago</button>
        </form>
      </Hoja>

      <input ref={camaraTicketRef} type="file" accept="image/*" capture="environment" hidden onChange={elegirTicket} />
      <input ref={galeriaTicketRef} type="file" accept="image/*" hidden onChange={elegirTicket} />
      <HojaTicket archivo={archivoTicket} cerrar={() => { setArchivoTicket(undefined); reanudarBloqueo() }} aplicar={aplicarTicket} />

      <AnimatePresence>
        {verTicket && (
          <motion.div className="fixed inset-0 z-[70] overflow-y-auto bg-black/85 p-4 pt-[calc(env(safe-area-inset-top)+64px)]" onClick={() => setVerTicket(undefined)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <img src={verTicket.foto} alt="Ticket" className="mx-auto max-h-[70dvh] rounded-2xl" />
            {verTicket.lineasTicket && (
              <div className="mx-auto mt-3 max-w-lg rounded-2xl bg-superficie p-3 text-sm">
                <div className="mb-1 font-bold">Gasto compartido</div>
                <ul>
                  {verTicket.lineasTicket.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3 py-0.5"><span className="min-w-0 truncate">{l.concepto}</span><span className="tabular-nums">{eur(l.importe)}</span></li>
                  ))}
                </ul>
                <div className="mt-1 flex justify-between border-t border-tinta/10 pt-1 font-bold"><span>Cuenta para el piso</span><span className="tabular-nums">{eur(verTicket.importe)}</span></div>
                {verTicket.totalTicket !== undefined && <div className="text-xs text-tinta/50">Total del ticket: {eur(verTicket.totalTicket)}</div>}
              </div>
            )}
            <button className="boton absolute top-[calc(env(safe-area-inset-top)+12px)] right-4 size-11 bg-white/15 p-0 text-white" aria-label="Cerrar"><X /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
