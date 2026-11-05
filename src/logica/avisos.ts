import type { Usuario, Pago, Limpieza, Aparcamiento, ArticuloCompra, Recurrente } from '../db'
import { ZONAS, turnoSemana, lunesIso, isoDia, sumarDias, type Ausencias } from './calculos'
import { fechaRecurrente } from './recurrentes'

export interface Aviso { id: string; emoji: string; texto: string; destino: 'pagos' | 'casa' | 'parking'; urgente?: boolean }

/** Recordatorios calculados en local (sin servidor de notificaciones). */
export function calcularAvisos(p: {
  yo: Usuario; alias: Record<Usuario, string>; pagos: Pago[]; limpiezas: Limpieza[]; parking: Aparcamiento[]
  compra: ArticuloCompra[]; recurrentes: Recurrente[]; ausencias: Ausencias; hoy?: Date
}): Aviso[] {
  const hoy = p.hoy ?? new Date()
  const hoyIso = isoDia(hoy)
  const r: Aviso[] = []

  // Pagos fijos que vencen en los próximos 3 días y siguen sin saldar
  for (const rec of p.recurrentes.filter((x) => x.activo && !x.borrado)) {
    const fecha = fechaRecurrente(rec, hoyIso.slice(0, 7))
    const dias = Math.round((new Date(fecha + 'T12:00').getTime() - new Date(hoyIso + 'T12:00').getTime()) / 864e5)
    const pago = p.pagos.find((x) => x.recurrenteId === rec.id && x.fecha.startsWith(hoyIso.slice(0, 7)))
    if (dias >= 0 && dias <= 3 && !pago?.saldado)
      r.push({ id: `rec-${rec.id}`, emoji: '📅', destino: 'pagos', urgente: dias <= 1,
        texto: `${rec.concepto} vence ${dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`}` })
  }

  // Zonas de limpieza de esta semana aún sin hacer (a partir del jueves)
  const sem = lunesIso(hoy)
  const pendientes = ZONAS.filter((z, i) => {
    const registro = p.limpiezas.find((l) => l.zona === z && l.fecha === sem && !l.borrado)
    return (registro?.asignadoA ?? turnoSemana(hoy, i, p.ausencias)) === p.yo && !registro?.hecho
  })
  if (pendientes.length && (hoy.getDay() >= 4 || hoy.getDay() === 0))
    r.push({ id: 'limpieza', emoji: '🧽', destino: 'casa', urgente: hoy.getDay() === 0, texto: `Te queda limpiar: ${pendientes.join(', ')}` })

  // Reserva de parking para mañana
  const manana = sumarDias(hoyIso, 1)
  const res = p.parking.find((x) => x.fecha === manana && x.reserva && !x.borrado)
  if (res) r.push({ id: 'parking', emoji: '🚗', destino: 'parking', texto: res.usuario === p.yo ? 'Mañana tienes la plaza reservada' : `Mañana la plaza es de ${p.alias[res.usuario]}` })

  const faltan = p.compra.filter((c) => !c.comprado && !c.borrado).length
  if (faltan) r.push({ id: 'compra', emoji: '🛒', destino: 'casa', texto: `${faltan} cosa(s) en la lista de la compra` })
  return r
}

/** Muestra una notificación del sistema una vez al día por aviso urgente (si el usuario lo permitió). */
export async function notificarUrgentes(avisos: Aviso[]) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  for (const a of avisos.filter((x) => x.urgente)) {
    const k = `notif-${a.id}-${isoDia()}`
    try { if (localStorage.getItem(k)) continue; localStorage.setItem(k, '1') } catch { /* sin storage */ }
    const op = { body: a.texto, icon: '/icono.svg', tag: a.id }
    if (reg) reg.showNotification('PisoCompartido', op)
    else new Notification('PisoCompartido', op)
  }
}
