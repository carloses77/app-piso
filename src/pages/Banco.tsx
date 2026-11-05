import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, FileText, Landmark, Loader2, Minus, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { db, nuevoId, type Extracto, type MovimientoBanco, type Usuario } from '../db'
import { borrarExtracto, guardarExtracto, huellaArchivo, leerPdf, MAX_PDF } from '../db/banco'
import { guardar } from '../db/operaciones'
import { useToast } from '../hooks/useAvisos'
import { pausarBloqueo, reanudarBloqueo, useAlias } from '../hooks/useSesion'
import { Cabecera, Hoja, Segmentos, TarjetaKPI, Vacio } from '../components/comunes'
import { eur, isoDia, lunesIso, sumarDias } from '../logica/calculos'
import { agruparPorSemana, calcularBalance, destacados, detectarAportante, interpretarExtracto, interpretarRecibo, NOMBRE_CATEGORIA, saldosDeSemana, saltoDeSaldo, yaRegistrado, type MovimientoBorrador } from '../logica/banco'
import { abrirPdf, extraerLineas, pintarPagina, type Progreso } from '../logica/lectorPdf'

const fechaCorta = (f: string) => new Date(f + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
const lunesDe = (f: string) => lunesIso(new Date(f + 'T12:00'))
const etiquetaSemana = (l: string) => `${fechaCorta(l)} – ${fechaCorta(sumarDias(l, 6))}`
const aNumero = (t: string) => {
  if (!t.trim()) return undefined
  const v = Number(t.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(v) ? v : undefined
}
const aTexto = (n?: number) => (n === undefined ? '' : n.toFixed(2).replace('.', ','))

interface Borrador {
  repetidos: number
  bytes: Uint8Array; huella: string; nombreArchivo: string; metodo: 'texto' | 'ocr'
  desde: string; hasta: string; saldoInicial: string; saldoFinal: string; movimientos: MovimientoBorrador[]
}

export default function Banco() {
  const toast = useToast()
  const alias = useAlias()
  const entrada = useRef<HTMLInputElement>(null)
  const [progreso, setProgreso] = useState<Progreso>()
  const [borrador, setBorrador] = useState<Borrador>()
  const [lunes, setLunes] = useState<string>()
  const [filtro, setFiltro] = useState<'todos' | 'ingresos' | 'gastos'>('todos')
  const [editando, setEditando] = useState<MovimientoBanco>()
  const [viendo, setViendo] = useState<Extracto>()

  const extractos = useLiveQuery(() => db.extractos.filter((e) => !e.borrado).toArray(), []) ?? []
  const movimientos = useLiveQuery(() => db.movimientos.filter((m) => !m.borrado).toArray(), []) ?? []

  const semanas = useMemo(() => agruparPorSemana(movimientos, lunesDe), [movimientos])
  const semana = semanas.find((s) => s.lunes === lunes) ?? semanas[0]
  const movsSemana = useMemo(() => [...(semana?.movimientos ?? [])].sort((a, b) => b.fecha.localeCompare(a.fecha)), [semana])
  const idsSemana = new Set(movsSemana.map((m) => m.extractoId))
  const docsSemana = extractos.filter((e) => idsSemana.has(e.id)).sort((a, b) => a.desde.localeCompare(b.desde))

  // Los saldos salen de los movimientos: un extracto puede abarcar muchas semanas y un recibo no trae saldo.
  const { saldoInicial, saldoFinal } = saldosDeSemana(movsSemana)
  const balance = calcularBalance(movsSemana, saldoInicial, saldoFinal)
  const top = destacados(movsSemana)
  const anterior = semanas.slice(semanas.findIndex((s) => s.lunes === semana?.lunes) + 1).map((s) => saldosDeSemana(s.movimientos)).find((s) => s.saldoFinal !== undefined)
  const salto = saltoDeSaldo(anterior, { saldoInicial })
  const dudosos = movsSemana.filter((m) => m.dudoso).length
  const lista = movsSemana.filter((m) => filtro === 'todos' || (filtro === 'ingresos' ? m.importe > 0 : m.importe < 0))

  function elegir() {
    pausarBloqueo(2 * 60_000)
    entrada.current?.click()
  }

  async function procesar(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return reanudarBloqueo()
    pausarBloqueo(10 * 60_000)
    try {
      if (archivo.size > MAX_PDF) throw new Error('El PDF supera el máximo de 8 MB.')
      const bytes = new Uint8Array(await archivo.arrayBuffer())
      const huella = await huellaArchivo(bytes)
      if (extractos.some((x) => x.huella === huella)) throw new Error('Este PDF ya está subido.')
      const { lineas, metodo } = await extraerLineas(bytes, setProgreso)
      const extracto = interpretarExtracto(lineas, nuevoId)
      const leido = extracto.movimientos.length ? extracto : interpretarRecibo(lineas, nuevoId) ?? extracto
      const nuevos = leido.movimientos.filter((m) => !yaRegistrado(m, movimientos))
      const repetidos = leido.movimientos.length - nuevos.length
      if (leido.movimientos.length && !nuevos.length) throw new Error('Todos los movimientos de este PDF ya están registrados.')
      const fechas = nuevos.map((m) => m.fecha).sort()
      setBorrador({
        repetidos, bytes, huella, nombreArchivo: archivo.name, metodo,
        desde: fechas[0] ?? (leido.desde || isoDia()), hasta: fechas.at(-1) ?? (leido.hasta || isoDia()),
        saldoInicial: aTexto(leido.saldoInicial), saldoFinal: aTexto(leido.saldoFinal),
        movimientos: nuevos.map((m) => ({ ...m, aportadoPor: m.importe > 0 ? detectarAportante(m.concepto, alias) : undefined })),
      })
    } catch (err) {
      toast({ tipo: 'error', texto: (err as Error).message })
    } finally {
      setProgreso(undefined)
      reanudarBloqueo()
    }
  }

  return (
    <div>
      <Cabecera titulo="Banco" icono={Landmark} extra={
        <button className="boton bg-marca text-white" onClick={elegir} disabled={!!progreso}><Upload size={18} /> Subir PDF</button>
      } />
      <input ref={entrada} type="file" accept="application/pdf,.pdf" hidden onChange={procesar} />

      {progreso && (
        <div className="tarjeta mb-3" role="status">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Loader2 size={18} className="animate-spin text-marca" /> {progreso.texto}</div>
          <div className="h-2 overflow-hidden rounded-full bg-marca-suave"><div className="h-full bg-marca transition-all" style={{ width: `${progreso.porcentaje}%` }} /></div>
          <p className="mt-2 text-xs text-tinta/50">El documento se lee en este móvil y no se envía a ningún servicio externo.</p>
        </div>
      )}

      {!semana ? (
        !progreso && <Vacio icono={Landmark} texto="Sube un extracto o recibo del banco en PDF para ver el balance de la semana." />
      ) : (
        <>
          <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
            {semanas.map((s) => (
              <button key={s.lunes} onClick={() => setLunes(s.lunes)} aria-pressed={s.lunes === semana.lunes}
                className={`min-h-10 shrink-0 rounded-full px-3 text-xs font-semibold ${s.lunes === semana.lunes ? 'bg-marca text-white' : 'bg-superficie'}`}>
                {etiquetaSemana(s.lunes)}
              </button>
            ))}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3">
            <TarjetaKPI icono={ArrowDownLeft} etiqueta="Ingresos" valor={eur(balance.ingresos)} color="#18b98d" />
            <TarjetaKPI icono={ArrowUpRight} etiqueta="Gastos" valor={eur(balance.gastos)} color="#ff5f4a" />
          </div>

          <section className="tarjeta mb-3">
            <h2 className="mb-2 font-bold">Balance de la semana</h2>
            <dl className="grid gap-1 text-sm">
              {saldoInicial !== undefined && <Fila nombre="Saldo inicial" valor={eur(saldoInicial)} />}
              <Fila nombre="Resultado de la semana" valor={`${balance.neto > 0 ? '+' : ''}${eur(balance.neto)}`} fuerte />
              {saldoFinal !== undefined && <Fila nombre="Saldo final" valor={eur(saldoFinal)} />}
            </dl>
            {balance.cuadra === true && <Aviso ok texto="Cuadra: el saldo inicial más los movimientos coincide con el saldo final." />}
            {balance.cuadra === false && <Aviso texto={`No cuadra: hay una diferencia de ${eur(balance.diferencia!)}. Revisa el PDF original.`} />}
            {balance.cuadra === undefined && <p className="mt-2 text-xs text-tinta/50">Los recibos no incluyen saldo: esta semana solo se muestra lo que recogen los documentos subidos, que puede no ser todo lo ocurrido en la cuenta.</p>}
            {salto !== undefined && <Aviso texto={`El saldo inicial difiere en ${eur(salto)} del último saldo conocido. Puede faltar un extracto.`} />}
            {dudosos > 0 && <Aviso texto={`${dudosos} movimiento${dudosos > 1 ? 's' : ''} con lectura dudosa. Compruébalo${dudosos > 1 ? 's' : ''} con el PDF.`} />}
          </section>

          <section className="tarjeta mb-3">
            <h2 className="mb-2 font-bold">Lo más destacado</h2>
            <ul className="grid gap-2 text-sm">
              {top.mayorGasto && <Destacado titulo="Mayor gasto" texto={top.mayorGasto.concepto} valor={eur(top.mayorGasto.importe)} />}
              {top.mayorIngreso && <Destacado titulo="Mayor ingreso" texto={top.mayorIngreso.concepto} valor={eur(top.mayorIngreso.importe)} />}
              {top.comisiones > 0 && <Destacado titulo="Comisiones del banco" texto="Cobradas esta semana" valor={eur(-top.comisiones)} />}
              {(balance.ingresos > 0) && <Destacado titulo="Aportaciones" texto={`${alias.A}: ${eur(top.aportes.A)} · ${alias.B}: ${eur(top.aportes.B)}${top.aportes.sin ? ` · Sin asignar: ${eur(top.aportes.sin)}` : ''}`} />}
              {top.categorias.length > 0 && <Destacado titulo="Gastos por categoría" texto={top.categorias.map((c) => `${NOMBRE_CATEGORIA[c.categoria]} ${eur(c.total)}`).join(' · ')} />}
            </ul>
          </section>

          <Segmentos valor={filtro} cambiar={setFiltro} opciones={[{ valor: 'todos', texto: 'Todos' }, { valor: 'ingresos', texto: 'Ingresos' }, { valor: 'gastos', texto: 'Gastos' }]} />
          {lista.length === 0 ? <Vacio icono={Landmark} texto="No hay movimientos con este filtro." /> : (
            <ul className="tarjeta mb-3 divide-y divide-tinta/5 !py-1">
              {lista.map((m) => (
                <li key={m.id}>
                  <button className="flex min-h-14 w-full items-center gap-3 py-2 text-left text-sm" onClick={() => setEditando(m)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{m.concepto}</span>
                      <span className="flex flex-wrap gap-x-2 text-xs text-tinta/50">
                        {fechaCorta(m.fecha)}
                        {m.aportadoPor && <span>{alias[m.aportadoPor]}</span>}
                        {m.editado && <span className="font-semibold text-marca">Corregido a mano</span>}
                        {m.dudoso && <span className="font-semibold text-amber-600">Revisar</span>}
                      </span>
                    </span>
                    <b className={`tabular-nums ${m.importe > 0 ? 'text-emerald-600' : ''}`}>{m.importe > 0 ? '+' : ''}{eur(m.importe)}</b>
                    <Pencil size={14} className="text-tinta/30" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <section className="tarjeta mb-3">
            <h2 className="mb-2 font-bold">Documentos de la semana</h2>
            <ul className="grid gap-1">
              {docsSemana.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <button className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setViendo(d)}>
                    <FileText size={18} className="shrink-0 text-marca" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{d.nombreArchivo}</span>
                      <span className="block text-xs text-tinta/50">Subido por {alias[d.subidoPor]}{d.metodo === 'ocr' ? ' · Leído con OCR' : ''}</span>
                    </span>
                  </button>
                  <button className="boton size-11 p-0 text-tinta/30" aria-label={`Borrar ${d.nombreArchivo}`} onClick={() => {
                    if (confirm(`¿Borrar ${d.nombreArchivo} y sus movimientos?`)) borrarExtracto(d, `Documento borrado: ${d.nombreArchivo}`)
                  }}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <Hoja abierta={!!borrador} cerrar={() => setBorrador(undefined)} titulo="Revisa antes de guardar">
        {borrador && <Revision borrador={borrador} cambiar={setBorrador} alias={alias} terminar={(fecha) => { setBorrador(undefined); setLunes(lunesDe(fecha)) }} />}
      </Hoja>
      <Hoja abierta={!!editando} cerrar={() => setEditando(undefined)} titulo="Corregir movimiento">
        {editando && <Edicion key={editando.id} mov={editando} alias={alias} cerrar={() => setEditando(undefined)} />}
      </Hoja>
      <Hoja abierta={!!viendo} cerrar={() => setViendo(undefined)} titulo={viendo?.nombreArchivo ?? 'PDF'}>
        {viendo && <VisorPdf extracto={viendo} />}
      </Hoja>
    </div>
  )
}

function Fila({ nombre, valor, fuerte }: { nombre: string; valor: string; fuerte?: boolean }) {
  return <div className={`flex justify-between gap-3 ${fuerte ? 'font-extrabold' : ''}`}><dt className={fuerte ? '' : 'text-tinta/60'}>{nombre}</dt><dd className="tabular-nums">{valor}</dd></div>
}

function Aviso({ texto, ok }: { texto: string; ok?: boolean }) {
  const I = ok ? CheckCircle2 : AlertTriangle
  return <p className={`mt-2 flex gap-2 rounded-2xl p-2 text-xs font-semibold ${ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}><I size={16} className="shrink-0" /> {texto}</p>
}

function Destacado({ titulo, texto, valor }: { titulo: string; texto: string; valor?: string }) {
  return (
    <li className="flex items-start justify-between gap-3">
      <span className="min-w-0"><span className="block text-xs text-tinta/50">{titulo}</span><span className="font-semibold">{texto}</span></span>
      {valor && <b className="shrink-0 tabular-nums">{valor}</b>}
    </li>
  )
}

function SelectorAportante({ valor, cambiar, alias }: { valor?: Usuario; cambiar: (u?: Usuario) => void; alias: Record<Usuario, string> }) {
  return (
    <select className="campo" aria-label="Quién hizo el ingreso" value={valor ?? ''} onChange={(e) => cambiar((e.target.value || undefined) as Usuario | undefined)}>
      <option value="">Ingreso sin asignar</option>
      <option value="A">Ingreso de {alias.A}</option>
      <option value="B">Ingreso de {alias.B}</option>
    </select>
  )
}

function Revision({ borrador: b, cambiar, alias, terminar }: {
  borrador: Borrador; cambiar: (b: Borrador) => void; alias: Record<Usuario, string>; terminar: (fecha: string) => void
}) {
  const toast = useToast()
  const [guardando, setGuardando] = useState(false)
  const actualizar = (id: string, cambios: Partial<MovimientoBorrador>) =>
    cambiar({ ...b, movimientos: b.movimientos.map((m) => (m.id === id ? { ...m, ...cambios, editado: true } as MovimientoBorrador : m)) })
  const ini = aNumero(b.saldoInicial)
  const fin = aNumero(b.saldoFinal)
  // Solo se guarda lo que cae dentro de las fechas elegidas, para dejar fuera movimientos ajenos al piso.
  const incluidos = b.movimientos.filter((m) => m.fecha >= b.desde && m.fecha <= b.hasta)
  const excluidos = b.movimientos.length - incluidos.length
  const bal = calcularBalance(b.movimientos, b.repetidos || excluidos ? undefined : ini, b.repetidos || excluidos ? undefined : fin)
  const dias = (new Date(b.desde).getTime() - new Date(b.hasta).getTime()) / -864e5

  async function confirmar() {
    if (!incluidos.length) return toast({ tipo: 'error', texto: 'Añade al menos un movimiento' })
    if (incluidos.some((m) => !m.fecha || !m.importe)) return toast({ tipo: 'error', texto: 'Cada movimiento necesita fecha e importe' })
    setGuardando(true)
    try {
      await guardarExtracto(
        { desde: b.desde, hasta: b.hasta, saldoInicial: ini, saldoFinal: fin, nombreArchivo: b.nombreArchivo, huella: b.huella, metodo: b.metodo },
        incluidos.map(({ id: _, ...m }, orden) => ({ ...m, orden })),
        b.bytes,
        `Documento subido: ${b.nombreArchivo} (${incluidos.length} mov.)`,
      )
      toast({ tipo: 'ok', texto: 'Documento guardado' })
      terminar(incluidos.at(-1)!.fecha)
    } catch {
      toast({ tipo: 'error', texto: 'No se ha podido guardar. Inténtalo de nuevo.' })
      setGuardando(false)
    }
  }

  return (
    <div className="max-h-[75dvh] overflow-y-auto">
      {b.metodo === 'ocr' && <Aviso texto="Documento escaneado leído con OCR: comprueba importes y fechas." />}
      {!b.movimientos.length && <Aviso texto="No se han reconocido movimientos. Puedes añadirlos a mano o comprobar que el PDF sea del banco." />}
      {b.repetidos > 0 && <Aviso ok texto={`${b.repetidos} movimiento${b.repetidos > 1 ? 's' : ''} ya registrado${b.repetidos > 1 ? 's' : ''} se ${b.repetidos > 1 ? 'han' : 'ha'} omitido.`} />}
      {dias > 31 && <Aviso texto="Abarca más de un mes. Ajusta «Desde» para compartir solo los movimientos del piso." />}
      <Aviso texto="El PDF original se comparte completo, con todo lo que contenga: titular, DNI y movimientos fuera de estas fechas." />
      {bal.cuadra === false && <Aviso texto={`Los saldos no cuadran por ${eur(bal.diferencia!)}. Revisa los movimientos.`} />}
      {bal.cuadra === true && <Aviso ok texto="Los saldos cuadran con los movimientos." />}

      <div className="my-3 grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold">Desde<input className="campo mt-1" type="date" value={b.desde} onChange={(e) => cambiar({ ...b, desde: e.target.value })} /></label>
        <label className="text-xs font-semibold">Hasta<input className="campo mt-1" type="date" value={b.hasta} onChange={(e) => cambiar({ ...b, hasta: e.target.value })} /></label>
        <label className="text-xs font-semibold">Saldo inicial<input className="campo mt-1" inputMode="decimal" placeholder="Opcional" value={b.saldoInicial} onChange={(e) => cambiar({ ...b, saldoInicial: e.target.value })} /></label>
        <label className="text-xs font-semibold">Saldo final<input className="campo mt-1" inputMode="decimal" placeholder="Opcional" value={b.saldoFinal} onChange={(e) => cambiar({ ...b, saldoFinal: e.target.value })} /></label>
      </div>

      <h3 className="mb-2 font-bold">{incluidos.length} movimiento{incluidos.length === 1 ? '' : 's'}{excluidos > 0 ? ` (${excluidos} fuera de fechas)` : ''}</h3>
      <ul className="grid gap-2">
        {incluidos.map((m) => (
          <li key={m.id} className={`tarjeta grid gap-2 !p-3 ${m.dudoso ? 'ring-2 ring-amber-500' : ''}`}>
            {m.dudoso && <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Lectura dudosa: compruébala</span>}
            <input className="campo" aria-label="Concepto" value={m.concepto} onChange={(e) => actualizar(m.id, { concepto: e.target.value })} />
            <input className="campo" type="date" aria-label="Fecha" value={m.fecha} onChange={(e) => actualizar(m.id, { fecha: e.target.value })} />
            <div className="grid grid-cols-[auto_1fr_auto] gap-2">
              <button className="boton size-12 bg-marca-suave p-0" aria-label={m.importe > 0 ? 'Cambiar a gasto' : 'Cambiar a ingreso'} onClick={() => actualizar(m.id, { importe: -m.importe, dudoso: false })}>{m.importe > 0 ? <Plus size={18} /> : <Minus size={18} />}</button>
              <input className="campo" inputMode="decimal" aria-label="Importe" key={`${m.id}-${Math.abs(m.importe)}`} defaultValue={aTexto(Math.abs(m.importe))}
                onBlur={(e) => { const v = Math.abs(aNumero(e.target.value) ?? 0); actualizar(m.id, { importe: m.importe > 0 ? v : -v, dudoso: false }) }} />
              <button className="boton size-12 p-0 text-tinta/40" aria-label="Quitar movimiento" onClick={() => cambiar({ ...b, movimientos: b.movimientos.filter((x) => x.id !== m.id) })}><Trash2 size={18} /></button>
            </div>
            {m.importe > 0 && <SelectorAportante valor={m.aportadoPor} alias={alias} cambiar={(u) => actualizar(m.id, { aportadoPor: u })} />}
          </li>
        ))}
      </ul>
      <button className="boton mt-2 w-full bg-superficie" onClick={() => cambiar({ ...b, movimientos: [...b.movimientos, { id: nuevoId(), fecha: b.hasta, concepto: '', importe: -0.01, dudoso: false }] })}><Plus size={18} /> Añadir movimiento</button>
      <button className="boton mt-2 w-full bg-marca text-white" disabled={guardando} onClick={confirmar}>{guardando ? 'Guardando…' : 'Guardar y compartir'}</button>
    </div>
  )
}

function Edicion({ mov, alias, cerrar }: { mov: MovimientoBanco; alias: Record<Usuario, string>; cerrar: () => void }) {
  const toast = useToast()
  const [concepto, setConcepto] = useState(mov.concepto)
  const [fecha, setFecha] = useState(mov.fecha)
  const [importe, setImporte] = useState(aTexto(Math.abs(mov.importe)))
  const [ingreso, setIngreso] = useState(mov.importe > 0)
  const [aportadoPor, setAportadoPor] = useState(mov.aportadoPor)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    const v = Math.abs(aNumero(importe) ?? 0)
    if (!v || !fecha) return toast({ tipo: 'error', texto: 'Indica la fecha y el importe' })
    const nuevo = ingreso ? v : -v
    const cambiaDato = nuevo !== mov.importe || fecha !== mov.fecha || concepto !== mov.concepto
    // Asignar quién hizo el ingreso no altera lo que dice el banco.
    await guardar('movimientos', { ...mov, concepto, fecha, importe: nuevo, aportadoPor: ingreso ? aportadoPor : undefined, dudoso: cambiaDato ? false : mov.dudoso, editado: mov.editado || cambiaDato },
      cambiaDato ? `Movimiento corregido: ${mov.concepto} (${eur(mov.importe)} → ${eur(nuevo)})` : `Ingreso asignado: ${concepto}`)
    cerrar()
  }

  return (
    <form onSubmit={enviar} className="grid gap-2">
      <input className="campo" aria-label="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
      <input className="campo" type="date" aria-label="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button type="button" className="boton size-12 bg-marca-suave p-0" aria-label={ingreso ? 'Cambiar a gasto' : 'Cambiar a ingreso'} onClick={() => setIngreso(!ingreso)}>{ingreso ? <Plus size={18} /> : <Minus size={18} />}</button>
        <input className="campo" inputMode="decimal" aria-label="Importe" value={importe} onChange={(e) => setImporte(e.target.value)} />
      </div>
      {ingreso && <SelectorAportante valor={aportadoPor} alias={alias} cambiar={setAportadoPor} />}
      <p className="text-xs text-tinta/50">Los cambios quedan marcados y constan en el histórico.</p>
      <button className="boton bg-marca text-white">Guardar</button>
    </form>
  )
}

function VisorPdf({ extracto }: { extracto: Extracto }) {
  const contenedor = useRef<HTMLDivElement>(null)
  const [estado, setEstado] = useState('Cargando…')

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        const r = await leerPdf(extracto)
        if ('faltan' in r) return setEstado(`El PDF aún se está recibiendo. Faltan ${r.faltan} de ${extracto.trozos} partes.`)
        const doc = await abrirPdf(r.bytes)
        for (let n = 1; n <= doc.numPages && !cancelado; n++) {
          const pagina = await doc.getPage(n)
          const canvas = document.createElement('canvas')
          canvas.className = 'mb-2 w-full rounded-xl bg-white'
          canvas.setAttribute('aria-label', `Página ${n} de ${doc.numPages}`)
          await pintarPagina(pagina, canvas, 2)
          if (!cancelado) contenedor.current?.append(canvas)
        }
        await doc.destroy()
        if (!cancelado) setEstado('')
      } catch {
        if (!cancelado) setEstado('No se ha podido abrir el PDF.')
      }
    })()
    return () => { cancelado = true }
  }, [extracto])

  return (
    <div className="max-h-[75dvh] overflow-y-auto">
      {estado && <p className="py-6 text-center text-sm text-tinta/50">{estado}</p>}
      <div ref={contenedor} />
    </div>
  )
}
