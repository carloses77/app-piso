import Dexie, { type EntityTable } from 'dexie'

export type Usuario = 'A' | 'B'
export type TipoPago = 'renta' | 'luz' | 'agua' | 'gas' | 'internet' | 'comunidad' | 'otro'

interface Base {
  id: string
  actualizado: number
  borrado?: boolean
}

export interface Periodo extends Base { inicio: string; fin: string; activo: boolean; saldoArrastrado: number }
export interface Pago extends Base {
  periodoId: string; tipo: TipoPago; concepto: string; importe: number; fecha: string
  pagadoPor: Usuario; partePagador: number // % que asume quien paga (50 = mitad)
  saldado: boolean
  foto?: string // ticket comprimido (dataURL), viaja cifrado
  recurrenteId?: string
}
export interface Recurrente extends Base {
  tipo: TipoPago; concepto: string; importe: number; dia: number; pagadoPor: Usuario; partePagador: number; activo: boolean
}
export interface ArticuloCompra extends Base { nombre: string; comprado: boolean; categoria: string; añadidoPor: Usuario }
export interface Lectura extends Base { tipo: 'luz' | 'agua' | 'gas'; fecha: string; valor: number }
export interface Limpieza extends Base { periodoId: string; zona: string; fecha: string; asignadoA: Usuario; hecho: boolean }
export interface Tarea extends Base { periodoId: string; titulo: string; estado: 'pendiente' | 'hecho'; asignadoA: Usuario | 'ambos' }
export interface Aparcamiento extends Base { periodoId: string; fecha: string; usuario: Usuario; reserva?: boolean; nota?: string }
export interface Ajuste extends Base { valor: string }
export interface Extracto extends Base {
  desde: string; hasta: string; saldoInicial?: number; saldoFinal?: number
  nombreArchivo: string; huella: string; metodo: 'texto' | 'ocr'; trozos: number; subidoPor: Usuario
}
export interface MovimientoBanco extends Base {
  extractoId: string; fecha: string; concepto: string
  importe: number // positivo = ingreso, negativo = gasto
  saldo?: number; dudoso?: boolean; aportadoPor?: Usuario
  orden?: number // posición en el documento: ordena movimientos del mismo día
  editado?: boolean // corregido a mano respecto a lo leído del PDF
}
export interface TrozoPdf extends Base { extractoId: string; indice: number; datos: string }

export interface Historial {
  id?: number; fecha: number; entidad: string; accion: 'crear' | 'editar' | 'borrar'; usuario: Usuario; resumen: string
}
export interface EventoCola { id?: number; creado: number; tabla: TablaSync; registro: Base; historial?: Historial }
export interface Config { clave: string; valor: string }

export const TABLAS_SYNC = ['periodos', 'pagos', 'limpiezas', 'tareas', 'parking', 'ajustes', 'recurrentes', 'compra', 'lecturas', 'extractos', 'movimientos', 'trozosPdf'] as const
export type TablaSync = (typeof TABLAS_SYNC)[number]

export class BaseDatos extends Dexie {
  periodos!: EntityTable<Periodo, 'id'>
  pagos!: EntityTable<Pago, 'id'>
  limpiezas!: EntityTable<Limpieza, 'id'>
  tareas!: EntityTable<Tarea, 'id'>
  parking!: EntityTable<Aparcamiento, 'id'>
  ajustes!: EntityTable<Ajuste, 'id'>
  recurrentes!: EntityTable<Recurrente, 'id'>
  compra!: EntityTable<ArticuloCompra, 'id'>
  lecturas!: EntityTable<Lectura, 'id'>
  extractos!: EntityTable<Extracto, 'id'>
  movimientos!: EntityTable<MovimientoBanco, 'id'>
  trozosPdf!: EntityTable<TrozoPdf, 'id'>
  historial!: EntityTable<Historial, 'id'>
  colaSync!: EntityTable<EventoCola, 'id'>
  config!: EntityTable<Config, 'clave'>

  constructor(nombre = 'piso-compartido') {
    super(nombre)
    this.version(1).stores({
      periodos: 'id, inicio, activo',
      pagos: 'id, periodoId, tipo, fecha, pagadoPor',
      limpiezas: 'id, periodoId, fecha, asignadoA',
      tareas: 'id, periodoId, estado',
      parking: 'id, periodoId, fecha, usuario',
      ajustes: 'id',
      historial: '++id, fecha, entidad',
      colaSync: '++id, creado',
      config: 'clave',
    })
    this.version(2).stores({
      recurrentes: 'id',
      compra: 'id, comprado',
      lecturas: 'id, tipo, fecha',
    })
    this.version(3).stores({
      extractos: 'id, desde, huella',
      movimientos: 'id, extractoId, fecha',
      trozosPdf: 'id, extractoId',
    })
  }
}

export const db = new BaseDatos()
export const nuevoId = () => crypto.randomUUID()

export async function leerConfig(clave: string) {
  return (await db.config.get(clave))?.valor
}
export const escribirConfig = (clave: string, valor: string) => db.config.put({ clave, valor })
