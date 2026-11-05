// Guarda los extractos como un lote: los trozos del PDF no deben llenar el histórico visible.
import { aBase64, deBase64 } from '../cripto'
import { db, nuevoId, type EventoCola, type Extracto, type MovimientoBanco, type TablaSync, type TrozoPdf } from './index'
import { obtenerUsuario } from './operaciones'

// El relay admite 200 000 caracteres por paquete, y cifrar y codificar en base64 hace crecer los datos.
const TAM_TROZO = 90_000
export const MAX_PDF = 8 * 1024 * 1024

export const trocearPdf = (bytes: Uint8Array) => {
  const trozos: string[] = []
  for (let i = 0; i < bytes.length; i += TAM_TROZO) trozos.push(aBase64(bytes.subarray(i, i + TAM_TROZO)))
  return trozos
}

export const huellaArchivo = async (bytes: Uint8Array) =>
  aBase64(await crypto.subtle.digest('SHA-256', bytes as BufferSource))

const TABLAS = () => [db.extractos, db.movimientos, db.trozosPdf, db.historial, db.colaSync]

export type DatosExtracto = Omit<Extracto, 'id' | 'actualizado' | 'borrado' | 'trozos' | 'subidoPor'>
export type DatosMovimiento = Pick<MovimientoBanco, 'fecha' | 'concepto' | 'importe' | 'saldo' | 'orden' | 'dudoso' | 'aportadoPor' | 'editado'>

export async function guardarExtracto(datos: DatosExtracto, movimientos: DatosMovimiento[], pdf: Uint8Array, resumen: string) {
  const ahora = Date.now()
  const id = nuevoId()
  const trozos = trocearPdf(pdf)
  const extracto: Extracto = { ...datos, id, actualizado: ahora, trozos: trozos.length, subidoPor: obtenerUsuario() }
  const filasMov: MovimientoBanco[] = movimientos.map((m) => ({ ...m, id: nuevoId(), extractoId: id, actualizado: ahora }))
  const filasPdf: TrozoPdf[] = trozos.map((t, indice) => ({ id: `${id}-${indice}`, extractoId: id, indice, datos: t, actualizado: ahora }))
  const historial = { fecha: ahora, entidad: 'extractos', accion: 'crear' as const, usuario: obtenerUsuario(), resumen }
  const evento = (tabla: TablaSync, registro: EventoCola['registro']): EventoCola => ({ creado: ahora, tabla, registro })
  await db.transaction('rw', TABLAS(), async () => {
    await db.movimientos.bulkPut(filasMov)
    await db.trozosPdf.bulkPut(filasPdf)
    await db.extractos.put(extracto)
    await db.historial.add(historial)
    // El extracto va el último: al recibirlo, el otro móvil ya tiene sus movimientos.
    await db.colaSync.bulkAdd([
      ...filasPdf.map((f) => evento('trozosPdf', f)),
      ...filasMov.map((f) => evento('movimientos', f)),
      { ...evento('extractos', extracto), historial },
    ])
  })
  return id
}

export async function borrarExtracto(extracto: Extracto, resumen: string) {
  const ahora = Date.now()
  const historial = { fecha: ahora, entidad: 'extractos', accion: 'borrar' as const, usuario: obtenerUsuario(), resumen }
  await db.transaction('rw', TABLAS(), async () => {
    const movs = (await db.movimientos.where('extractoId').equals(extracto.id).toArray()).map((m) => ({ ...m, borrado: true, actualizado: ahora }))
    // Se vacía el contenido del PDF para liberar espacio en el móvil.
    const trozos = (await db.trozosPdf.where('extractoId').equals(extracto.id).toArray()).map((t) => ({ ...t, datos: '', borrado: true, actualizado: ahora }))
    const ext = { ...extracto, borrado: true, actualizado: ahora }
    await db.movimientos.bulkPut(movs)
    await db.trozosPdf.bulkPut(trozos)
    await db.extractos.put(ext)
    await db.historial.add(historial)
    await db.colaSync.bulkAdd([
      ...trozos.map((f) => ({ creado: ahora, tabla: 'trozosPdf' as const, registro: f })),
      ...movs.map((f) => ({ creado: ahora, tabla: 'movimientos' as const, registro: f })),
      { creado: ahora, tabla: 'extractos' as const, registro: ext, historial },
    ])
  })
}

/** Recompone el PDF. Devuelve cuántos trozos faltan si aún no han llegado todos. */
export async function leerPdf(extracto: Extracto): Promise<{ bytes: Uint8Array } | { faltan: number }> {
  const filas = (await db.trozosPdf.where('extractoId').equals(extracto.id).toArray()).filter((t) => !t.borrado && t.datos)
  if (filas.length < extracto.trozos) return { faltan: extracto.trozos - filas.length }
  const partes = filas.sort((a, b) => a.indice - b.indice).map((f) => deBase64(f.datos))
  const bytes = new Uint8Array(partes.reduce((s, p) => s + p.length, 0))
  let pos = 0
  for (const p of partes) { bytes.set(p, pos); pos += p.length }
  return { bytes }
}
