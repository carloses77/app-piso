import { db, nuevoId, type TablaSync, type Usuario, type Historial, type Periodo } from './index'

let usuarioActual: Usuario = 'A'
export const fijarUsuario = (u: Usuario) => (usuarioActual = u)
export const obtenerUsuario = () => usuarioActual

const tabla = (t: TablaSync) => db.table(t)

/** Una edición siempre gana a lo que ya había, aunque el reloj del otro móvil vaya adelantado. */
const marcaTiempo = (existe?: { actualizado: number }) => Math.max(Date.now(), (existe?.actualizado ?? 0) + 1)

/** Guarda un registro, deja rastro en el histórico y lo encola para sincronizar. */
export async function guardar<T extends { id?: string } & Record<string, unknown>>(
  t: TablaSync,
  datos: T,
  resumen: string,
): Promise<string> {
  const id = datos.id ?? nuevoId()
  const existe = datos.id ? await tabla(t).get(id) : undefined
  const registro = { ...existe, ...datos, id, actualizado: marcaTiempo(existe) }
  const historial: Historial = {
    fecha: registro.actualizado,
    entidad: t,
    accion: existe ? 'editar' : 'crear',
    usuario: usuarioActual,
    resumen,
  }
  await db.transaction('rw', [tabla(t), db.historial, db.colaSync], async () => {
    await tabla(t).put(registro)
    await db.historial.add(historial)
    await db.colaSync.add({ creado: Date.now(), tabla: t, registro, historial })
  })
  return id
}

export async function borrar(t: TablaSync, id: string, resumen: string) {
  const existe = await tabla(t).get(id)
  if (!existe) return
  const registro = { ...existe, borrado: true, actualizado: marcaTiempo(existe) }
  const historial: Historial = { fecha: registro.actualizado, entidad: t, accion: 'borrar', usuario: usuarioActual, resumen }
  await db.transaction('rw', [tabla(t), db.historial, db.colaSync], async () => {
    await tabla(t).put(registro)
    await db.historial.add(historial)
    await db.colaSync.add({ creado: Date.now(), tabla: t, registro, historial })
  })
}

/** Aplica un evento recibido del otro dispositivo (last-write-wins). */
export async function aplicarRemoto(t: TablaSync, registro: { id: string; actualizado: number }, historial?: Historial) {
  await db.transaction('rw', [tabla(t), db.historial], async () => {
    const local = await tabla(t).get(registro.id)
    if (local && local.actualizado >= registro.actualizado) return
    await tabla(t).put(registro)
    if (historial) await db.historial.add({ ...historial, id: undefined })
  })
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

export async function periodoActivo(): Promise<Periodo | undefined> {
  const todos = await db.periodos.filter((p) => p.activo && !p.borrado).toArray()
  return todos.sort((a, b) => b.inicio.localeCompare(a.inicio))[0]
}

/** Crea el primer periodo anual o devuelve el activo. */
export async function asegurarPeriodo(hoy = new Date()): Promise<Periodo> {
  const act = await periodoActivo()
  if (act) return act
  const fin = new Date(hoy)
  fin.setFullYear(fin.getFullYear() + 1)
  fin.setDate(fin.getDate() - 1)
  const id = await guardar('periodos', { inicio: iso(hoy), fin: iso(fin), activo: true, saldoArrastrado: 0 }, 'Periodo anual creado')
  return (await db.periodos.get(id))!
}

/** Cierra el periodo actual y abre uno nuevo de 1 año arrastrando el saldo pendiente. */
export async function renovarPeriodo(saldoPendiente: number, hoy = new Date()) {
  const act = await periodoActivo()
  if (act) await guardar('periodos', { ...act, activo: false }, 'Periodo cerrado')
  const fin = new Date(hoy)
  fin.setFullYear(fin.getFullYear() + 1)
  fin.setDate(fin.getDate() - 1)
  await guardar(
    'periodos',
    { inicio: iso(hoy), fin: iso(fin), activo: true, saldoArrastrado: saldoPendiente },
    `Periodo renovado (saldo arrastrado ${saldoPendiente.toFixed(2)} €)`,
  )
}
