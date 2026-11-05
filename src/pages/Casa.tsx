import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, CookingPot, Bath, Sofa, Trash, CheckCircle2, Circle, Plus, ListTodo, Trash2, ShoppingCart, Flame, Plane, Pencil, ArrowLeftRight, Check, X, type LucideIcon } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDatosPeriodo } from '../hooks/useDatos'
import { useAlias, useSesion } from '../hooks/useSesion'
import { useAusencias } from '../hooks/useAjustes'
import { useToast, vibrar } from '../hooks/useAvisos'
import { guardar, borrar } from '../db/operaciones'
import { Avatar, Cabecera, Segmentos, Vacio, colorUsuario } from '../components/comunes'
import { ZONAS, turnoSemana, lunesIso, puntosLimpieza, INSIGNIAS, estaAusente, isoDia } from '../logica/calculos'
import { db, type Tarea, type Usuario } from '../db'

const ICONO_ZONA: Record<string, LucideIcon> = { Cocina: CookingPot, Baño: Bath, Salón: Sofa, Basura: Trash }
const CATEGORIAS = [
  { id: 'limpieza', emoji: '🧴', nombre: 'Limpieza' },
  { id: 'comida', emoji: '🥫', nombre: 'Despensa' },
  { id: 'baño', emoji: '🧻', nombre: 'Baño' },
  { id: 'otros', emoji: '📦', nombre: 'Otros' },
]
const SUGERENCIAS = ['Papel higiénico', 'Lavavajillas', 'Detergente', 'Bolsas basura', 'Aceite', 'Sal', 'Esponjas', 'Lejía']

type Vista = 'limpieza' | 'tareas' | 'compra'

export default function Casa() {
  const [vista, setVista] = useState<Vista>('limpieza')
  return (
    <div>
      <Cabecera titulo="Casa" icono={Sparkles} />
      <Segmentos valor={vista} cambiar={setVista} opciones={[
        { valor: 'limpieza', texto: '🧽 Limpieza' }, { valor: 'tareas', texto: '🛠️ Tareas' }, { valor: 'compra', texto: '🛒 Compra' }]} />
      {vista === 'limpieza' ? <Limpieza /> : vista === 'tareas' ? <Tareas /> : <Compra />}
    </div>
  )
}

function Limpieza() {
  const d = useDatosPeriodo()
  const alias = useAlias()
  const ausencias = useAusencias()
  const toast = useToast()
  if (!d) return null

  const semanas = [0, 1, 2, 3].map((i) => { const f = new Date(); f.setDate(f.getDate() + i * 7); return f })
  const hecha = (zona: string, sem: string) => d.limpiezas.find((l) => l.zona === zona && l.fecha === sem)

  async function alternar(zona: string, fecha: Date, idx: number) {
    if (!d?.periodo) return
    const sem = lunesIso(fecha)
    const ya = hecha(zona, sem)
    const quien = turnoSemana(fecha, idx, ausencias)
    if (ya) await guardar('limpiezas', { ...ya, hecho: !ya.hecho }, `${zona}: ${ya.hecho ? 'desmarcada' : 'limpia'} (${alias[ya.asignadoA]})`)
    else await guardar('limpiezas', { periodoId: d.periodo.id, zona, fecha: sem, asignadoA: quien, hecho: true }, `${zona}: limpia (${alias[quien]})`)
    if (!ya?.hecho) { vibrar([10, 30, 10]); toast({ tipo: 'ok', texto: `${zona} limpia · +10 puntos` }) }
  }

  async function reasignar(zona: string, fecha: Date, idx: number) {
    if (!d?.periodo) return
    const sem = lunesIso(fecha)
    const ya = hecha(zona, sem)
    const otro: Usuario = (ya?.asignadoA ?? turnoSemana(fecha, idx, ausencias)) === 'A' ? 'B' : 'A'
    const resumen = `${zona}: ahora le toca a ${alias[otro]}`
    if (ya) await guardar('limpiezas', { ...ya, asignadoA: otro }, resumen)
    else await guardar('limpiezas', { periodoId: d.periodo.id, zona, fecha: sem, asignadoA: otro, hecho: false }, resumen)
    toast({ tipo: 'ok', texto: resumen })
  }

  const stats = { A: puntosLimpieza(d.limpiezas, 'A'), B: puntosLimpieza(d.limpiezas, 'B') }
  const lider: Usuario | null = stats.A.puntos === stats.B.puntos ? null : stats.A.puntos > stats.B.puntos ? 'A' : 'B'

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-3">
        {(['A', 'B'] as const).map((u) => {
          const s = stats[u]
          const ganadas = INSIGNIAS.filter((i) => i.cumple(s.total, s.racha))
          return (
            <div key={u} className="tarjeta relative overflow-hidden !p-3">
              {lider === u && <span className="absolute top-2 right-2 text-lg" title="Va ganando">👑</span>}
              <div className="mb-1 flex items-center gap-2">
                <Avatar u={u} nombre={alias[u]} tam={30} />
                <span className="truncate text-sm font-semibold">{alias[u]}</span>
              </div>
              <div className="text-2xl font-extrabold tabular-nums" style={{ color: colorUsuario(u) }}>{s.puntos}<span className="text-xs font-semibold text-tinta/40"> pts</span></div>
              <div className="flex items-center gap-1 text-xs text-tinta/60"><Flame size={14} className={s.racha ? 'text-a' : ''} /> Racha {s.racha} sem.</div>
              <div className="mt-1 flex gap-0.5 text-base" aria-label="Insignias">
                {INSIGNIAS.map((i) => <span key={i.id} title={i.nombre} className={ganadas.includes(i) ? '' : 'opacity-15 grayscale'}>{i.emoji}</span>)}
              </div>
              {estaAusente(ausencias[u], isoDia()) && <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-marca"><Plane size={12} /> De viaje</div>}
            </div>
          )
        })}
      </div>

      {semanas.map((fecha, si) => (
        <section key={si} className={`tarjeta mb-3 ${si > 0 ? 'opacity-80' : ''}`}>
          <h2 className="mb-2 text-sm font-bold text-tinta/60">
            {si === 0 ? 'Esta semana' : `Semana del ${new Date(lunesIso(fecha) + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {ZONAS.map((z, i) => {
              const Icono = ICONO_ZONA[z]
              const registro = hecha(z, lunesIso(fecha))
              const quien = registro?.asignadoA ?? turnoSemana(fecha, i, ausencias)
              const ok = registro?.hecho
              return (
                <div key={z} className={`flex items-stretch rounded-2xl border-2 transition-colors ${ok ? 'border-b bg-b/10' : 'border-transparent bg-fondo'}`}>
                <motion.button whileTap={si === 0 ? { scale: 0.95 } : undefined} onClick={() => alternar(z, fecha, i)} disabled={si > 0}
                  aria-pressed={!!ok}
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-2 p-2 text-left">
                  <Icono size={22} className="shrink-0 text-marca" />
                  <span className="min-w-0 flex-1 text-sm font-semibold">{z}<br /><small className="font-normal" style={{ color: colorUsuario(quien) }}>{alias[quien]}</small></span>
                  {si === 0 && (ok
                    ? <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.25, bounce: 0.4 }}><CheckCircle2 className="text-b" /></motion.span>
                    : <Circle className="text-tinta/20" />)}
                </motion.button>
                <button type="button" aria-label={`Pasar ${z} a ${alias[quien === 'A' ? 'B' : 'A']}`} className="grid w-9 shrink-0 place-items-center text-tinta/40"
                  onClick={() => reasignar(z, fecha, i)}><ArrowLeftRight size={15} /></button>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}

function Tareas() {
  const d = useDatosPeriodo()
  const alias = useAlias()
  const toast = useToast()
  const [nueva, setNueva] = useState('')
  const [asignar, setAsignar] = useState<Usuario | 'ambos'>('ambos')
  if (!d) return null
  return (
    <>
      <form className="tarjeta mb-3 grid gap-2" onSubmit={async (e) => {
        e.preventDefault()
        if (!nueva.trim() || !d.periodo) return
        await guardar('tareas', { periodoId: d.periodo.id, titulo: nueva.trim(), estado: 'pendiente', asignadoA: asignar }, `Tarea: ${nueva.trim()}`)
        setNueva('')
        toast({ tipo: 'ok', texto: 'Tarea añadida' })
      }}>
        <div className="flex gap-2">
          <input className="campo" placeholder="Ej. cambiar bombilla del pasillo" value={nueva} onChange={(e) => setNueva(e.target.value)} maxLength={60} />
          <button className="boton size-12 shrink-0 bg-marca p-0 text-white" aria-label="Añadir tarea"><Plus /></button>
        </div>
        <div className="flex gap-2 text-xs">
          {(['ambos', 'A', 'B'] as const).map((u) => (
            <button type="button" key={u} onClick={() => setAsignar(u)} aria-pressed={asignar === u}
              className={`min-h-9 rounded-full px-3 font-semibold ${asignar === u ? 'bg-marca text-white' : 'bg-marca-suave'}`}>
              {u === 'ambos' ? '👥 Ambos' : alias[u]}
            </button>
          ))}
        </div>
      </form>
      {d.tareas.length === 0 ? <Vacio icono={ListTodo} texto="Sin tareas comunes. Apunta aquí arreglos, gestiones o compras grandes." /> : (
        (['pendiente', 'hecho'] as const).map((estado) => {
          const xs = d.tareas.filter((t) => t.estado === estado)
          if (!xs.length) return null
          return (
            <section key={estado} className="mb-3">
              <h2 className="mb-2 text-sm font-bold text-tinta/50">{estado === 'pendiente' ? `Pendientes (${xs.length})` : `Hechas (${xs.length})`}</h2>
              <ul className="grid gap-2">
                <AnimatePresence initial={false}>
                  {xs.map((t) => (
                    <motion.li key={t.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                      className="tarjeta !p-3">
                      <FilaTarea t={t} />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          )
        })
      )}
    </>
  )
}

function FilaTarea({ t }: { t: Tarea }) {
  const alias = useAlias()
  const toast = useToast()
  const [edicion, setEdicion] = useState<{ titulo: string; asignadoA: Tarea['asignadoA'] }>()

  if (edicion) {
    const nombre = (u: Tarea['asignadoA']) => (u === 'ambos' ? 'ambos' : alias[u])
    return (
      <form className="grid gap-2" onSubmit={async (e) => {
        e.preventDefault()
        const titulo = edicion.titulo.trim()
        if (!titulo) return toast({ tipo: 'error', texto: 'Ponle un nombre a la tarea' })
        if (titulo !== t.titulo || edicion.asignadoA !== t.asignadoA) {
          await guardar('tareas', { ...t, titulo, asignadoA: edicion.asignadoA }, `Tarea cambiada: ${titulo} (${nombre(edicion.asignadoA)})`)
          toast({ tipo: 'ok', texto: 'Tarea actualizada' })
        }
        setEdicion(undefined)
      }}>
        <input className="campo" aria-label="Nombre de la tarea" value={edicion.titulo} maxLength={60} autoFocus onChange={(e) => setEdicion({ ...edicion, titulo: e.target.value })} />
        <div className="flex items-center gap-2 text-xs">
          {(['ambos', 'A', 'B'] as const).map((u) => (
            <button type="button" key={u} onClick={() => setEdicion({ ...edicion, asignadoA: u })} aria-pressed={edicion.asignadoA === u}
              className={`min-h-9 min-w-0 truncate rounded-full px-3 font-semibold ${edicion.asignadoA === u ? 'bg-marca text-white' : 'bg-marca-suave'}`}>
              {u === 'ambos' ? '👥 Ambos' : alias[u]}
            </button>
          ))}
          <span className="flex-1" />
          <button type="button" aria-label="Cancelar" className="boton size-10 shrink-0 p-0 text-tinta/40" onClick={() => setEdicion(undefined)}><X size={18} /></button>
          <button aria-label="Guardar tarea" className="boton size-10 shrink-0 bg-marca p-0 text-white"><Check size={18} /></button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button aria-label="Cambiar estado" className="boton size-10 shrink-0 p-0" onClick={() => {
        if (t.estado === 'pendiente') vibrar([10, 30, 10])
        guardar('tareas', { ...t, estado: t.estado === 'hecho' ? 'pendiente' : 'hecho' }, `Tarea ${t.estado === 'hecho' ? 'reabierta' : 'hecha'}: ${t.titulo}`)
      }}>
        {t.estado === 'hecho' ? <CheckCircle2 className="text-b" /> : <Circle className="text-tinta/25" />}
      </button>
      <span className={`min-w-0 flex-1 ${t.estado === 'hecho' ? 'text-tinta/40 line-through' : 'font-semibold'}`}>{t.titulo}</span>
      {t.asignadoA !== 'ambos' && <Avatar u={t.asignadoA} nombre={alias[t.asignadoA]} tam={24} />}
      <button aria-label="Editar tarea" className="boton size-10 shrink-0 p-0 text-tinta/40" onClick={() => setEdicion({ titulo: t.titulo, asignadoA: t.asignadoA })}><Pencil size={17} /></button>
      <button aria-label="Borrar tarea" className="boton size-10 shrink-0 p-0 text-tinta/30" onClick={() => {
        borrar('tareas', t.id, `Tarea borrada: ${t.titulo}`)
        toast({ tipo: 'ok', texto: 'Tarea borrada', deshacer: () => guardar('tareas', { ...t, borrado: false }, `Tarea restaurada: ${t.titulo}`) })
      }}><Trash2 size={18} /></button>
    </div>
  )
}

function Compra() {
  const { sesion } = useSesion()
  const alias = useAlias()
  const toast = useToast()
  const items = useLiveQuery(() => db.compra.filter((c) => !c.borrado).toArray(), []) ?? []
  const [nombre, setNombre] = useState('')
  const [cat, setCat] = useState('limpieza')

  const añadir = async (n: string) => {
    const limpio = n.trim()
    if (!limpio) return
    if (items.some((i) => !i.comprado && i.nombre.toLowerCase() === limpio.toLowerCase())) return toast({ tipo: 'error', texto: 'Ya está en la lista' })
    await guardar('compra', { nombre: limpio, comprado: false, categoria: cat, añadidoPor: sesion!.rol }, `Compra: ${limpio}`)
    setNombre('')
  }
  const pendientes = items.filter((i) => !i.comprado)
  const comprados = items.filter((i) => i.comprado)

  return (
    <>
      <form className="tarjeta mb-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); añadir(nombre) }}>
        <div className="flex gap-2">
          <input className="campo" placeholder="¿Qué falta en casa?" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} />
          <button className="boton size-12 shrink-0 bg-marca p-0 text-white" aria-label="Añadir a la lista"><Plus /></button>
        </div>
        <div className="sin-barra flex gap-2 overflow-x-auto">
          {CATEGORIAS.map((c) => (
            <button type="button" key={c.id} onClick={() => setCat(c.id)} aria-pressed={cat === c.id}
              className={`min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold ${cat === c.id ? 'bg-marca text-white' : 'bg-marca-suave'}`}>{c.emoji} {c.nombre}</button>
          ))}
        </div>
        <div className="sin-barra flex gap-1.5 overflow-x-auto pt-1">
          {SUGERENCIAS.filter((s) => !pendientes.some((p) => p.nombre === s)).map((s) => (
            <button type="button" key={s} onClick={() => añadir(s)} className="shrink-0 rounded-full border border-tinta/10 px-2.5 py-1 text-xs text-tinta/60">+ {s}</button>
          ))}
        </div>
      </form>

      {items.length === 0 ? <Vacio icono={ShoppingCart} texto="La lista está vacía. Toca una sugerencia para empezar." /> : (
        <>
          {CATEGORIAS.map((c) => {
            const xs = pendientes.filter((p) => p.categoria === c.id)
            if (!xs.length) return null
            return (
              <section key={c.id} className="mb-3">
                <h2 className="mb-1.5 text-sm font-bold text-tinta/50">{c.emoji} {c.nombre}</h2>
                <ul className="tarjeta divide-y divide-tinta/5 !py-1">
                  {xs.map((i) => (
                    <li key={i.id} className="flex min-h-12 items-center gap-3">
                      <button className="boton size-10 p-0" aria-label="Marcar comprado" onClick={() => { vibrar(); guardar('compra', { ...i, comprado: true }, `Comprado: ${i.nombre}`) }}>
                        <Circle className="text-tinta/25" />
                      </button>
                      <span className="flex-1 font-semibold">{i.nombre}</span>
                      <Avatar u={i.añadidoPor} nombre={alias[i.añadidoPor]} tam={20} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {comprados.length > 0 && (
            <section>
              <div className="mb-1.5 flex items-center">
                <h2 className="flex-1 text-sm font-bold text-tinta/50">✅ Comprado ({comprados.length})</h2>
                <button className="text-xs font-bold text-marca" onClick={() => comprados.forEach((i) => borrar('compra', i.id, `Quitado de la lista: ${i.nombre}`))}>Vaciar</button>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {comprados.map((i) => (
                  <li key={i.id}>
                    <button className="rounded-full bg-superficie px-3 py-1.5 text-xs text-tinta/40 line-through" onClick={() => guardar('compra', { ...i, comprado: false }, `Vuelve a faltar: ${i.nombre}`)}>{i.nombre}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  )
}
