import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Plus, Trash2 } from 'lucide-react'
import { Hoja } from './comunes'
import { eur } from '../logica/calculos'
import { comprimirFoto } from '../logica/imagen'
import { leerTicket } from '../logica/lectorTicket'
import { aNumero, sumaLineas, type LineaTicket } from '../logica/ticket'
import type { Progreso } from '../logica/lectorPdf'
import { reanudarBloqueo } from '../hooks/useSesion'

export interface TicketRevisado {
  concepto: string; fecha?: string; foto: string; total?: number
  lineas: LineaTicket[] // solo las compartidas
}
interface Fila { id: string; concepto: string; importe: string; compartida: boolean }

const nuevaFila = (concepto = '', importe = ''): Fila => ({ id: crypto.randomUUID(), concepto, importe, compartida: true })
const validas = (filas: Fila[]) => filas
  .map((f) => ({ ...f, concepto: f.concepto.trim(), valor: aNumero(f.importe) }))
  .filter((f) => Number.isFinite(f.valor))
  .map((f) => ({ concepto: f.concepto || 'Sin nombre', importe: f.valor, compartida: f.compartida }))

/** Lee la foto y deja marcar qué líneas son compartidas: el resto no cuenta para el piso. */
export default function HojaTicket({ archivo, cerrar, aplicar }: {
  archivo?: File; cerrar: () => void; aplicar: (t: TicketRevisado) => void
}) {
  const [progreso, setProgreso] = useState<Progreso>()
  const [filas, setFilas] = useState<Fila[]>([])
  const [foto, setFoto] = useState('')
  const [datos, setDatos] = useState<{ comercio?: string; fecha?: string; total?: number }>({})
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    if (!archivo) return
    let cancelado = false
    setProgreso({ texto: 'Preparando la foto…', porcentaje: 0 })
    setFilas([]); setFoto(''); setDatos({}); setAviso('')
    void (async () => {
      try {
        const comprimida = await comprimirFoto(archivo, 1400)
        if (cancelado) return
        setFoto(comprimida)
        const leido = await leerTicket(archivo, (p) => { if (!cancelado) setProgreso(p) })
        if (cancelado) return
        setDatos(leido)
        setFilas(leido.lineas.map((l) => nuevaFila(l.concepto, l.importe.toFixed(2).replace('.', ','))))
        if (!leido.lineas.length) setAviso('No se han reconocido productos. Añádelos a mano o repite la foto con más luz.')
      } catch {
        if (!cancelado) setAviso('No se ha podido leer el ticket. Puedes añadir las líneas a mano.')
      } finally {
        if (!cancelado) { setProgreso(undefined); reanudarBloqueo() }
      }
    })()
    return () => { cancelado = true }
  }, [archivo])

  const cambiar = (id: string, cambios: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...cambios } : f)))
  const todas = validas(filas)
  const compartidas = todas.filter((l) => l.compartida)
  const compartido = sumaLineas(compartidas)
  const leido = sumaLineas(todas)
  const descuadre = datos.total !== undefined && Math.abs(leido - datos.total) > 0.005
  const todasMarcadas = filas.length > 0 && filas.every((f) => f.compartida)

  function continuar() {
    aplicar({
      concepto: (datos.comercio ? `Compra ${datos.comercio}` : 'Compra').slice(0, 40),
      fecha: datos.fecha, foto, total: datos.total,
      lineas: compartidas.map(({ concepto, importe }) => ({ concepto, importe })),
    })
  }

  return (
    <Hoja abierta={!!archivo} cerrar={cerrar} titulo="Ticket">
      {progreso ? (
        <div className="py-6" role="status">
          <p className="mb-2 text-sm font-semibold">{progreso.texto}</p>
          <div className="h-2 overflow-hidden rounded-full bg-marca-suave">
            <div className="h-full bg-marca transition-[width]" style={{ width: `${progreso.porcentaje}%` }} />
          </div>
          <p className="mt-2 text-xs text-tinta/50">Se lee en tu móvil; la primera vez tarda un poco más.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm text-tinta/60">Desmarca lo que sea personal: solo cuenta lo marcado.</p>
            {filas.length > 0 && (
              <button type="button" className="shrink-0 text-sm font-bold text-marca"
                onClick={() => setFilas((fs) => fs.map((f) => ({ ...f, compartida: !todasMarcadas })))}>
                {todasMarcadas ? 'Ninguna' : 'Todas'}
              </button>
            )}
          </div>

          {aviso && <p className="rounded-2xl bg-a/10 p-3 text-sm">{aviso}</p>}

          <ul className="grid max-h-[42dvh] gap-2 overflow-y-auto">
            {filas.map((f) => (
              <li key={f.id} className={`flex items-center gap-1.5 rounded-2xl bg-superficie p-1.5 ${f.compartida ? '' : 'opacity-50'}`}>
                <button type="button" role="checkbox" aria-checked={f.compartida} aria-label={`Compartido: ${f.concepto || 'línea'}`}
                  onClick={() => cambiar(f.id, { compartida: !f.compartida })}
                  className={`boton size-11 shrink-0 p-0 ${f.compartida ? 'bg-marca text-white' : 'border-2 border-tinta/15'}`}>
                  {f.compartida && <Check size={18} />}
                </button>
                <input className="min-h-11 w-full min-w-0 bg-transparent text-sm outline-none" placeholder="Producto" aria-label="Producto"
                  value={f.concepto} onChange={(e) => cambiar(f.id, { concepto: e.target.value })} />
                <input className="min-h-11 w-16 shrink-0 bg-transparent text-right text-sm font-bold tabular-nums outline-none" inputMode="decimal" placeholder="0,00" aria-label="Importe"
                  value={f.importe} onChange={(e) => cambiar(f.id, { importe: e.target.value.replace(/[^\d.,-]/g, '') })} />
                <button type="button" aria-label={`Quitar ${f.concepto || 'línea'}`} className="boton size-11 shrink-0 p-0 text-tinta/30"
                  onClick={() => setFilas((fs) => fs.filter((x) => x.id !== f.id))}><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>

          <button type="button" className="boton bg-marca-suave text-marca" onClick={() => setFilas((fs) => [...fs, nuevaFila()])}>
            <Plus size={18} /> Añadir línea
          </button>

          {descuadre && (
            <p className="flex items-start gap-2 rounded-2xl bg-a/10 p-3 text-sm">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              Las líneas suman {eur(leido)} y el total del ticket es {eur(datos.total!)}. Revisa los importes.
            </p>
          )}

          <div className="flex items-baseline rounded-2xl bg-superficie p-3">
            <span className="flex-1 text-sm font-semibold">Gasto compartido</span>
            <b className="text-xl tabular-nums">{eur(compartido)}</b>
          </div>
          {leido !== compartido && <p className="-mt-2 text-right text-xs text-tinta/50">Personal, no cuenta: {eur(sumaLineas([{ importe: leido }, { importe: -compartido }]))}</p>}

          <button type="button" className="boton min-h-13 bg-marca text-lg text-white disabled:opacity-40" disabled={!(compartido > 0) || !foto} onClick={continuar}>
            Continuar
          </button>
        </div>
      )}
    </Hoja>
  )
}
