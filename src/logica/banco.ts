// Interpretación de extractos bancarios y cálculo del balance. Sin dependencias del navegador.
import type { MovimientoBanco, TipoPago, Usuario } from '../db'

export interface Celda { x: number; ancho: number; texto: string; y?: number }
export type LineaPdf = Celda[]

export interface MovimientoBorrador {
  id: string
  fecha: string
  concepto: string
  importe: number // positivo = ingreso, negativo = gasto
  saldo?: number
  dudoso: boolean // el signo o el importe no se ha podido confirmar
  editado?: boolean
  aportadoPor?: Usuario
}

export interface ExtractoLeido {
  desde: string
  hasta: string
  saldoInicial?: number
  saldoFinal?: number
  movimientos: MovimientoBorrador[]
}

const MESES: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 }
const FECHA_NUM = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/
const FECHA_TXT = /\b(\d{1,2})\s+(?:de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\.?(?:\s+(?:de\s+)?(\d{2,4}))?\b/i
const IMPORTE = /[-−+]?\s?(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+[.,]\d{2})(?!\d)(?:\s?[-−])?/g
const NO_CONTINUA = /p[aá]gina|saldo|total|suma|iban|titular|entidad|oficina|www\.|fecha/i

const redondear = (n: number) => Math.round(n * 100) / 100

/** Convierte "1.234,56-" o "−1,234.56" en número con signo. */
export function leerImporte(txt: string): { valor: number; signo?: 1 | -1 } | undefined {
  const limpio = txt.replace(/\s/g, '').replace('−', '-')
  const negativo = limpio.startsWith('-') || limpio.endsWith('-')
  const positivo = limpio.startsWith('+')
  const cuerpo = limpio.replace(/[-+]/g, '')
  const sep = Math.max(cuerpo.lastIndexOf(','), cuerpo.lastIndexOf('.'))
  if (sep < 0) return undefined
  const valor = Number(cuerpo.slice(0, sep).replace(/[.,]/g, '') + '.' + cuerpo.slice(sep + 1))
  if (!Number.isFinite(valor)) return undefined
  return { valor: negativo ? -valor : valor, signo: negativo ? -1 : positivo ? 1 : undefined }
}

function isoDe(d: number, m: number, a: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function buscarFecha(txt: string, anioPorDefecto: number) {
  const n = FECHA_NUM.exec(txt)
  const t = FECHA_TXT.exec(txt)
  const m = n && (!t || n.index <= t.index) ? n : t
  if (!m) return undefined
  const mes = m === n ? Number(m[2]) : MESES[m[2].toLowerCase().slice(0, 3)]
  const anio = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : anioPorDefecto
  const iso = isoDe(Number(m[1]), mes, anio)
  return iso ? { iso, conAnio: !!m[3], indice: m.index, largo: m[0].length } : undefined
}

function importesDe(linea: LineaPdf) {
  const out: { valor: number; signo?: 1 | -1; centro?: number }[] = []
  for (const c of linea) {
    // Las fechas no deben confundirse con importes (p. ej. 12.11.2026).
    const sinFechas = c.texto.replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, ' ')
    for (const m of sinFechas.matchAll(IMPORTE)) {
      const leido = leerImporte(m[0])
      if (leido) out.push({ ...leido, centro: c.x + c.ancho / 2 })
    }
  }
  return out
}

const textoDe = (l: LineaPdf) => l.map((c) => c.texto).join(' ').replace(/\s+/g, ' ').trim()

/** Une un signo suelto a la celda siguiente: el OCR suele separar "-" de "45,00". */
function unirSignos(l: LineaPdf): LineaPdf {
  const out: LineaPdf = []
  for (const c of l) {
    const prev = out.at(-1)
    if (prev && /^[-−+]$/.test(prev.texto.trim())) {
      out[out.length - 1] = { x: prev.x, ancho: c.x + c.ancho - prev.x, texto: prev.texto.trim() + c.texto }
    } else out.push(c)
  }
  return out
}

interface Columnas { debe?: number; haber?: number; concepto?: number; importe?: number; saldo?: number }

function detectarColumnas(l: LineaPdf): Columnas | undefined {
  const txt = textoDe(l).toLowerCase()
  if (!/fecha/.test(txt) || !/(concepto|descripci|movimiento|detalle|operaci)/.test(txt)) return undefined
  const col: Columnas = {}
  for (const c of l) {
    const t = c.texto.toLowerCase()
    if (/\b(debe|cargos?|salidas?|gastos?|retiradas?)\b/.test(t)) col.debe = c.x + c.ancho / 2
    if (/\b(haber|abonos?|entradas?|ingresos?)\b/.test(t)) col.haber = c.x + c.ancho / 2
    if (/\b(concepto|descripci[oó]n|detalle)\b/.test(t)) col.concepto = c.x + c.ancho / 2
    if (/\bimporte\b/.test(t)) col.importe = c.x + c.ancho / 2
    if (/\bsaldo\b/.test(t)) col.saldo = c.x + c.ancho / 2
  }
  return col
}

function signoPorColumna(centro: number | undefined, col: Columnas): 1 | -1 | undefined {
  if (centro === undefined || col.debe === undefined || col.haber === undefined) return undefined
  return Math.abs(centro - col.haber) < Math.abs(centro - col.debe) ? 1 : -1
}

/** Indica si una celda cae en la columna de concepto, cuando el encabezado permite saberlo. */
function enConcepto(c: Celda, col: Columnas) {
  if (col.concepto === undefined || col.importe === undefined) return false
  const centro = c.x + c.ancho / 2
  return Math.abs(centro - col.concepto) < Math.abs(centro - col.importe)
}

/** Oculta números de tarjeta completos: el concepto se comparte con el resto del piso. */
export const ocultarTarjetas = (txt: string) => txt.replace(/\b\d{12,19}\b/g, (n) => `····${n.slice(-4)}`)

const parecenIngreso = (c: string) => /ingreso|abono|n[oó]mina|recibid|devoluci|a su favor|intereses/i.test(c)

/** Convierte las líneas de un PDF (u OCR) en movimientos. Lo dudoso se marca para revisarlo. */
export function interpretarExtracto(lineas: LineaPdf[], crearId: () => string, hoy = new Date()): ExtractoLeido {
  // El año del encabezado permite completar fechas del tipo 12/11.
  let anio = hoy.getFullYear()
  for (const l of lineas) {
    const f = buscarFecha(textoDe(l), anio)
    if (f?.conAnio) { anio = Number(f.iso.slice(0, 4)); break }
  }

  let columnas: Columnas = {}
  let saldoInicial: number | undefined
  let saldoFinal: number | undefined
  let desde: string | undefined
  let hasta: string | undefined
  const movs: (MovimientoBorrador & { signoSeguro: boolean; y?: number; antes: string[]; despues: string[] })[] = []
  const sueltos: { y: number; texto: string }[] = []
  let continuable = false

  for (const original of lineas) {
    const linea = unirSignos(original)
    const texto = textoDe(linea)
    if (!texto) continue
    const cab = detectarColumnas(linea)
    if (cab) { columnas = cab; continuable = false; continue }

    const importes = importesDe(linea.filter((c) => !enConcepto(c, columnas)))
    const ultimo = importes.at(-1)?.valor
    if (/saldo\s+(inicial|anterior|al inicio|de apertura)/i.test(texto) && ultimo !== undefined) { saldoInicial = ultimo; continuable = false; continue }
    if (/saldo\s+(final|actual|al cierre|de cierre)/i.test(texto) && ultimo !== undefined) { saldoFinal = ultimo; continuable = false; continue }

    const periodo = /(?:del?|desde)\s+(.{5,20}?)\s+(?:al?|hasta)\s+(.{5,20})/i.exec(texto)
    if (periodo && !importes.length) {
      const a = buscarFecha(periodo[1], anio)
      const b = buscarFecha(periodo[2], anio)
      if (a && b) { desde = a.iso; hasta = b.iso; continue }
    }

    const fecha = buscarFecha(texto, anio)
    const esMovimiento = fecha && fecha.indice <= 3 && importes.length > 0 && !/^(total|suma)/i.test(texto)
    if (!esMovimiento) {
      // Con posiciones, el concepto partido se asigna después a la fila más cercana.
      if (columnas.concepto !== undefined && linea[0]?.y !== undefined) {
        if (linea.every((c) => enConcepto(c, columnas)) && !NO_CONTINUA.test(texto)) sueltos.push({ y: linea[0].y, texto })
        continue
      }
      if (continuable && !importes.length && !NO_CONTINUA.test(texto) && movs.length) {
        const m = movs[movs.length - 1]
        m.concepto = `${m.concepto} ${texto}`.slice(0, 140)
      } else continuable = false
      continue
    }

    // Quita fechas e importes del texto para dejar solo el concepto.
    const delConcepto = linea.filter((c) => enConcepto(c, columnas) && !/^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/.test(c.texto.trim()))
    const concepto = (delConcepto.length ? textoDe(delConcepto) : texto
      .replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, ' ')
      .replace(new RegExp(FECHA_TXT.source, 'gi'), ' ')
      .replace(IMPORTE, ' ')
      .replace(/\b(EUR|€)\b|€/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    const principal = importes[0]
    const saldo = importes.length > 1 ? ultimo : undefined
    const signoColumna = signoPorColumna(principal.centro, columnas)
    const signo = principal.signo ?? signoColumna
    const abs = Math.abs(principal.valor)
    movs.push({
      id: crearId(),
      fecha: fecha.iso,
      concepto: concepto || 'Movimiento',
      importe: signo ? signo * abs : parecenIngreso(concepto) ? abs : -abs,
      saldo,
      dudoso: false,
      signoSeguro: !!signo,
      y: linea[0]?.y,
      antes: [],
      despues: [],
    })
    continuable = true
  }

  const conY = movs.filter((m) => m.y !== undefined)
  if (conY.length && sueltos.length) {
    const huecos = [...conY.slice(1).map((m, i) => m.y! - conY[i].y!), ...sueltos.map((f) => Math.min(...conY.map((m) => Math.abs(m.y! - f.y))))].filter((h) => h > 0).sort((a, b) => a - b)
    const alcance = (huecos[Math.floor(huecos.length / 2)] ?? 0) * 2.5
    for (const f of sueltos) {
      const cerca = conY.reduce((a, b) => (Math.abs(b.y! - f.y) < Math.abs(a.y! - f.y) ? b : a))
      if (Math.abs(cerca.y! - f.y) > alcance) continue
      ;(f.y < cerca.y! ? cerca.antes : cerca.despues).push(f.texto)
    }
  }
  for (const m of movs) {
    const fila = m.concepto === 'Movimiento' && (m.antes.length || m.despues.length) ? [] : [m.concepto]
    m.concepto = [...m.antes, ...fila, ...m.despues].join(' ')
  }

  // Si el documento marca los cargos con "-", un importe sin signo es un ingreso.
  if (movs.some((m) => m.signoSeguro && m.importe < 0)) {
    for (const m of movs) if (!m.signoSeguro) { m.importe = Math.abs(m.importe); m.signoSeguro = true }
  }

  // Algunos bancos listan primero lo más reciente: se pasa a orden cronológico.
  if (movs.length > 1 && movs[0].fecha > movs[movs.length - 1].fecha) movs.reverse()

  // El saldo es la mejor comprobación: confirma el signo y destapa errores de lectura.
  let previo = saldoInicial
  for (const m of movs) {
    if (m.saldo !== undefined && previo !== undefined) {
      const dif = redondear(m.saldo - previo)
      if (Math.abs(Math.abs(dif) - Math.abs(m.importe)) <= 0.01) {
        m.importe = dif
        m.signoSeguro = true
      } else m.dudoso = true
    }
    if (!m.signoSeguro) m.dudoso = true
    previo = m.saldo ?? (previo !== undefined ? redondear(previo + m.importe) : undefined)
  }

  const fechas = movs.map((m) => m.fecha).sort()
  const primero = movs[0]
  const movimientos: MovimientoBorrador[] = movs.map((m) => ({
    id: m.id, fecha: m.fecha, importe: m.importe, saldo: m.saldo, dudoso: m.dudoso,
    concepto: ocultarTarjetas(m.concepto).slice(0, 200),
  }))
  return {
    desde: desde ?? fechas[0] ?? '',
    hasta: hasta ?? fechas.at(-1) ?? '',
    saldoInicial: saldoInicial ?? (primero?.saldo !== undefined && !primero.dudoso ? redondear(primero.saldo - primero.importe) : undefined),
    saldoFinal: saldoFinal ?? movs.at(-1)?.saldo,
    movimientos,
  }
}

/** Recibo o justificante de una sola operación, como el adeudo que descarga la app del banco. */
export function interpretarRecibo(lineas: LineaPdf[], crearId: () => string, hoy = new Date()): ExtractoLeido | undefined {
  const textos = lineas.map(textoDe)
  const todo = textos.join('\n')
  const esCargo = /adeudo|adeudamos|nota de cargo|recibo domiciliado|transferencia emitida/i.test(todo)
  const esAbono = /nota de abono|abonamos|ingreso en cuenta|transferencia recibida/i.test(todo)
  if (esCargo === esAbono) return undefined

  const lineaFecha = textos.find((t) => /^fecha\b/i.test(t)) ?? textos.find((t) => /\bfecha\b.*\d/i.test(t))
  const fecha = lineaFecha && buscarFecha(lineaFecha, hoy.getFullYear())
  // El mayor importe es el total: incluye la comisión si la hay.
  const importes = lineas.flatMap(importesDe).map((i) => Math.abs(i.valor))
  if (!fecha || !importes.length) return undefined
  const importe = Math.max(...importes)

  const iOrdenante = textos.findIndex((t) => /entidad ordenante|ordenante|beneficiario/i.test(t))
  const contraparte = iOrdenante >= 0 ? lineas[iOrdenante + 1]?.[0]?.texto.trim() : undefined
  const detalle = /^Rec\.?:.*?\d{2}[/.-]\d{2}[/.-]\d{2,4}\s+([\p{L} ]+?)(?:\s+\d|$)/iu.exec(textos.find((t) => /^Rec\.?:/i.test(t)) ?? '')?.[1]
  const concepto = [detalle, contraparte].filter(Boolean).join(' · ') || (esCargo ? 'Adeudo' : 'Abono')
  return {
    desde: fecha.iso,
    hasta: fecha.iso,
    movimientos: [{ id: crearId(), fecha: fecha.iso, concepto, importe: esCargo ? -importe : importe, dudoso: false }],
  }
}

export type Categoria = TipoPago | 'comision' | 'aportacion' | 'retirada'

export const NOMBRE_CATEGORIA: Record<Categoria, string> = {
  renta: 'Renta', luz: 'Luz', agua: 'Agua', gas: 'Gas', internet: 'Internet', comunidad: 'Comunidad',
  otro: 'Otros', comision: 'Comisiones', aportacion: 'Aportaciones', retirada: 'Retiradas',
}

const REGLAS: [RegExp, Categoria][] = [
  [/comisi[oó]n|mantenimiento de cuenta|cuota (de )?(cuenta|tarjeta)/i, 'comision'],
  [/alquiler|renta\b|arrendamiento/i, 'renta'],
  [/endesa|iberdrola|naturgy.*luz|electricidad|\bluz\b|holaluz|repsol.*luz/i, 'luz'],
  [/canal de isabel|aguas?\b|aqualia|emasesa/i, 'agua'],
  [/naturgy|\bgas\b/i, 'gas'],
  [/movistar|vodafone|orange|digi\b|fibra|internet|masmovil|jazztel|pepephone/i, 'internet'],
  [/comunidad|propietarios/i, 'comunidad'],
  [/cajero|reintegro|retirada/i, 'retirada'],
]

export function categorizar(concepto: string, importe: number): Categoria {
  if (importe > 0) return 'aportacion'
  return REGLAS.find(([r]) => r.test(concepto))?.[1] ?? 'otro'
}

/** Propone quién hizo un ingreso buscando su apodo en el concepto. */
export function detectarAportante(concepto: string, alias: Record<Usuario, string>): Usuario | undefined {
  const c = concepto.toLowerCase()
  const a = alias.A.toLowerCase()
  const b = alias.B.toLowerCase()
  const hayA = a.length > 2 && c.includes(a)
  const hayB = b.length > 2 && c.includes(b)
  return hayA === hayB ? undefined : hayA ? 'A' : 'B'
}

type MovimientoBalance = Pick<MovimientoBanco, 'concepto' | 'importe' | 'fecha' | 'aportadoPor'> & { id: string; borrado?: boolean }

export function calcularBalance(movs: MovimientoBalance[], saldoInicial?: number, saldoFinal?: number) {
  const vivos = movs.filter((m) => !m.borrado)
  const ingresos = redondear(vivos.filter((m) => m.importe > 0).reduce((s, m) => s + m.importe, 0))
  const gastos = redondear(vivos.filter((m) => m.importe < 0).reduce((s, m) => s - m.importe, 0))
  const neto = redondear(ingresos - gastos)
  const conSaldos = saldoInicial !== undefined && saldoFinal !== undefined
  const diferencia = conSaldos ? redondear(saldoInicial + neto - saldoFinal) : undefined
  return { ingresos, gastos, neto, diferencia, cuadra: diferencia === undefined ? undefined : Math.abs(diferencia) < 0.01 }
}

export function destacados(movs: MovimientoBalance[]) {
  const vivos = movs.filter((m) => !m.borrado)
  const mayorIngreso = vivos.filter((m) => m.importe > 0).sort((a, b) => b.importe - a.importe)[0]
  const mayorGasto = vivos.filter((m) => m.importe < 0).sort((a, b) => a.importe - b.importe)[0]
  const aportes: Record<Usuario | 'sin', number> = { A: 0, B: 0, sin: 0 }
  const porCategoria = new Map<Categoria, number>()
  for (const m of vivos) {
    if (m.importe > 0) aportes[m.aportadoPor ?? 'sin'] = redondear(aportes[m.aportadoPor ?? 'sin'] + m.importe)
    else {
      const c = categorizar(m.concepto, m.importe)
      porCategoria.set(c, redondear((porCategoria.get(c) ?? 0) - m.importe))
    }
  }
  const categorias = [...porCategoria].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total)
  return { mayorIngreso, mayorGasto, aportes, categorias, comisiones: porCategoria.get('comision') ?? 0 }
}

/** Reúne por semana los movimientos, con independencia del documento del que procedan. */
export function agruparPorSemana<T extends { fecha: string; borrado?: boolean }>(movs: T[], lunesDe: (fecha: string) => string) {
  const semanas = new Map<string, T[]>()
  for (const m of movs) {
    if (m.borrado) continue
    const lunes = lunesDe(m.fecha)
    semanas.set(lunes, [...(semanas.get(lunes) ?? []), m])
  }
  return [...semanas].sort((a, b) => b[0].localeCompare(a[0])).map(([lunes, movimientos]) => ({ lunes, movimientos }))
}

/** Mismo movimiento ya guardado: permite subir extractos solapados, o un recibo y su extracto. */
export function yaRegistrado(m: { fecha: string; importe: number; saldo?: number }, otros: { fecha: string; importe: number; saldo?: number }[]) {
  return otros.some((o) => o.fecha === m.fecha && o.importe === m.importe && (o.saldo === undefined || m.saldo === undefined || o.saldo === m.saldo))
}

/** Saldos de una semana a partir de los movimientos, ya que un extracto puede abarcar muchas. */
export function saldosDeSemana<T extends { fecha: string; importe: number; saldo?: number; orden?: number }>(movs: T[]) {
  const conSaldo = movs.filter((m) => m.saldo !== undefined)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.orden ?? 0) - (b.orden ?? 0))
  const primero = conSaldo[0]
  const ultimo = conSaldo.at(-1)
  return {
    saldoInicial: primero ? redondear(primero.saldo! - primero.importe) : undefined,
    saldoFinal: ultimo?.saldo,
  }
}

export const seSolapan = (a: { desde: string; hasta: string }, b: { desde: string; hasta: string }) => a.desde <= b.hasta && b.desde <= a.hasta

/** Devuelve un aviso si el saldo inicial no continúa el saldo final del extracto anterior. */
export function saltoDeSaldo(anterior: { saldoFinal?: number } | undefined, actual: { saldoInicial?: number }) {
  if (anterior?.saldoFinal === undefined || actual.saldoInicial === undefined) return undefined
  const d = redondear(actual.saldoInicial - anterior.saldoFinal)
  return Math.abs(d) < 0.01 ? undefined : d
}
