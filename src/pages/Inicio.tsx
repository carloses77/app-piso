import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from 'recharts'
import { LayoutDashboard, Scale, Wallet, Car, Sparkles, CalendarClock, RefreshCw } from 'lucide-react'
import { useDatosPeriodo } from '../hooks/useDatos'
import { useAlias, useSesion } from '../hooks/useSesion'
import { useBotonSync } from '../hooks/useBotonSync'
import { calcularSaldo, gastosPorTipo, conteoParkingMes, mesActual, eur, ZONAS, turnoSemana, lunesIso } from '../logica/calculos'
import { Avatar, Cabecera, ICONO_PAGO, TarjetaKPI, colorUsuario } from '../components/comunes'
import { db, type TipoPago } from '../db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { motion } from 'motion/react'
import { ChevronRight, Flame } from 'lucide-react'
import { useAusencias } from '../hooks/useAjustes'
import { calcularAvisos, notificarUrgentes } from '../logica/avisos'
import { puntosLimpieza } from '../logica/calculos'

export default function Inicio({ ir }: { ir: (s: string) => void }) {
  const d = useDatosPeriodo()
  const alias = useAlias()
  const { sesion } = useSesion()
  const { sincronizarAhora, girando } = useBotonSync()
  const ausencias = useAusencias()
  const compra = useLiveQuery(() => db.compra.toArray(), []) ?? []
  const recurrentes = useLiveQuery(() => db.recurrentes.toArray(), []) ?? []
  const avisos = d && sesion ? calcularAvisos({ yo: sesion.rol, alias, pagos: d.pagos, limpiezas: d.limpiezas, parking: d.parking, compra, recurrentes, ausencias }) : []
  const claveAvisos = avisos.map((a) => a.id).join()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { notificarUrgentes(avisos) }, [claveAvisos])
  if (!d) return null
  const yo = sesion!.rol
  const otro = yo === 'A' ? 'B' : 'A'
  const saldoA = calcularSaldo(d.pagos, d.periodo?.saldoArrastrado)
  const miSaldo = yo === 'A' ? saldoA : -saldoA
  const mes = mesActual()
  const pagosMes = d.pagos.filter((p) => p.fecha.startsWith(mes))
  const totalMes = pagosMes.reduce((s, p) => s + p.importe, 0)
  const tipos = gastosPorTipo(pagosMes)
  const park = conteoParkingMes(d.parking, mes)
  const hoy = new Date()
  const misZonas = ZONAS.filter((z, i) => {
    const registro = d.limpiezas.find((l) => l.zona === z && l.fecha === lunesIso(hoy))
    return (registro?.asignadoA ?? turnoSemana(hoy, i, ausencias)) === yo
  })
  const racha = puntosLimpieza(d.limpiezas, yo)
  const diasRestantes = d.periodo ? Math.ceil((new Date(d.periodo.fin).getTime() - hoy.getTime()) / 864e5) : 0

  // Gasto por mes (últimos 6)
  const meses = [...Array(6)].map((_, i) => {
    const f = new Date(hoy.getFullYear(), hoy.getMonth() - 5 + i, 15)
    const m = mesActual(f)
    return { mes: f.toLocaleDateString('es-ES', { month: 'short' }), total: d.pagos.filter((p) => p.fecha.startsWith(m)).reduce((s, p) => s + p.importe, 0) }
  })

  return (
    <div>
      <Cabecera titulo={`Hola, ${alias[yo]}`} icono={LayoutDashboard}
        extra={<button onClick={sincronizarAhora} disabled={girando} aria-label="Sincronizar" className="boton size-11 bg-superficie p-0">
          <RefreshCw size={18} className={girando ? 'animate-spin' : ''} />
        </button>} />

      {/* Balance principal */}
      <section className="tarjeta mb-3 overflow-hidden bg-gradient-to-br from-marca to-[#9b8cff] text-white">
        <div className="flex items-center gap-2 text-sm font-semibold opacity-85"><Scale size={18} /> Balance entre los dos</div>
        <div className="my-3 flex items-center justify-between">
          <Avatar u={yo} nombre={alias[yo]} tam={48} />
          <div className="text-center">
            <div className="text-3xl font-extrabold tabular-nums">{eur(Math.abs(miSaldo))}</div>
            <div className="text-sm opacity-90">
              {miSaldo === 0 ? '¡Estáis en paz! 🎉' : miSaldo > 0 ? `${alias[otro]} te debe` : `Debes a ${alias[otro]}`}
            </div>
          </div>
          <Avatar u={otro} nombre={alias[otro]} tam={48} />
        </div>
      </section>

      {!d.periodo && (
        <div className="tarjeta mb-3 text-center text-sm text-tinta/60">⏳ Esperando los datos del piso desde el móvil de tu compi…</div>
      )}

      {avisos.length > 0 && (
        <section className="mb-3 grid gap-2" aria-label="Avisos">
          {avisos.map((a, i) => (
            <motion.button key={a.id} onClick={() => ir(a.destino)} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04, duration: 0.2 }}
              className={`tarjeta flex items-center gap-3 !py-3 text-left text-sm transition-transform active:scale-[.98] ${a.urgente ? 'ring-2 ring-a/60' : ''}`}>
              <span className="text-xl">{a.emoji}</span>
              <span className="flex-1 font-semibold">{a.texto}</span>
              <ChevronRight size={18} className="text-tinta/30" />
            </motion.button>
          ))}
        </section>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3">
        <TarjetaKPI icono={Wallet} etiqueta="Gasto del mes" valor={eur(totalMes)} color="#6d5efc" pie={`${pagosMes.length} pagos`} />
        <TarjetaKPI icono={CalendarClock} etiqueta="Periodo" valor={`${Math.max(diasRestantes, 0)} d`} color="#2f9bff" pie="hasta renovar" />
      </div>

      {/* Donut de gastos */}
      <section className="tarjeta mb-3">
        <h2 className="mb-2 font-bold">¿En qué se va el dinero?</h2>
        {tipos.length === 0 ? <p className="py-6 text-center text-sm text-tinta/40">Sin gastos este mes</p> : (
          <div className="flex items-center gap-3">
            <div className="relative size-36 shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={tipos} dataKey="total" nameKey="tipo" innerRadius="62%" outerRadius="100%" paddingAngle={3} stroke="none">
                    {tipos.map((t) => <Cell key={t.tipo} fill={ICONO_PAGO[t.tipo as TipoPago].color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="grid flex-1 gap-1.5 text-sm">
              {tipos.map((t) => {
                const info = ICONO_PAGO[t.tipo as TipoPago]
                return (
                  <li key={t.tipo} className="flex items-center gap-2">
                    <info.icono size={16} style={{ color: info.color }} />
                    <span className="flex-1">{info.nombre}</span>
                    <b className="tabular-nums">{eur(t.total)}</b>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </section>

      {/* Parking y limpieza */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <section className="tarjeta" onClick={() => ir('parking')}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><Car size={18} className="text-marca" /> Parking este mes</h2>
          {(['A', 'B'] as const).map((u) => {
            const max = Math.max(park.A, park.B, 1)
            return (
              <div key={u} className="mb-2">
                <div className="flex justify-between text-xs"><span>{alias[u]}</span><b>{park[u]}</b></div>
                <div className="h-2.5 rounded-full bg-tinta/5">
                  <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${(park[u] / max) * 100}%`, background: colorUsuario(u) }} />
                </div>
              </div>
            )
          })}
        </section>
        <button className="tarjeta text-left transition-transform active:scale-[.98]" onClick={() => ir('casa')}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold"><Sparkles size={18} className="text-b" /> Te toca</h2>
          <ul className="grid gap-1 text-sm">
            {misZonas.length ? misZonas.map((z) => <li key={z} className="rounded-xl bg-b/10 px-2 py-1 font-semibold text-b">{z}</li>)
              : <li className="text-tinta/50">Nada esta semana 🏖️</li>}
          </ul>
          <div className="mt-2 flex items-center gap-1 text-xs text-tinta/55"><Flame size={14} className={racha.racha ? 'text-a' : ''} /> {racha.puntos} pts · racha {racha.racha}</div>
        </button>
      </div>

      <section className="tarjeta">
        <h2 className="mb-2 font-bold">Últimos 6 meses</h2>
        <div className="h-36">
          <ResponsiveContainer>
            <BarChart data={meses}>
              <XAxis dataKey="mes" axisLine={false} tickLine={false} fontSize={12} stroke="currentColor" />
              <Tooltip formatter={(v) => eur(Number(v))} cursor={{ fill: '#6d5efc11' }} />
              <Bar dataKey="total" fill="#6d5efc" radius={[8, 8, 8, 8]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}
