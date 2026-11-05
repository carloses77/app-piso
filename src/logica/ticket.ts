// Interpreta el texto leído de un ticket. No depende del navegador para poder probarlo a fondo.
import { isoDia } from './calculos'

export interface LineaTicket { concepto: string; importe: number }
export interface TicketLeido { comercio?: string; fecha?: string; total?: number; lineas: LineaTicket[] }

const IMPORTE_FINAL = /(-\s?)?(\d{1,4})\s?[.,]\s?(\d{2})\s?(-)?\s*(?:€|EUROS?|EUR)?\s*[A-D*]?\s*$/i
const TOTAL = /(?:^|[^A-Z])T\s*[O0]\s*T\s*A\s*[L1I](?![A-Z])/
const NO_ES_TOTAL = /ARTICULOS|AHORRO|IVA|BASE/
const NO_ES_PRODUCTO = /\b(?:SUB\s?TOTAL|BASE(?:\s+IMP\w*)?\b(?!\s+[A-Z])|I\.?V\.?A|IGIC|CUOTA|ENTREGAD[OA]|ENTREGA|EFECTIVO|CAMBIO|DEVOLUCION|TARJETA|VISA|MASTERCARD|CREDITO|DEBITO|CONTACTLESS|PAGO|COBRO|RECIBIDO|N\.?I\.?F|C\.?I\.?F|TEL|TELEFONO|FACTURA|TICKET|ARTICULOS|AHORRO|PUNTOS|SALDO|AUTORIZ\w*|COMERCIO|TERMINAL|IMPORTE)\b/

const mayusculas = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
const redondear = (n: number) => Math.round(n * 100) / 100
const letras = (t: string) => (t.match(/\p{L}/gu) ?? []).length

/** El OCR confunde a menudo el 0 con la O dentro de un importe. */
const corregirCeros = (t: string) => t
  .replace(/(?<![\p{L}\d])[Oo](?=[.,]\d)/gu, '0')
  .replace(/(?<=\d[.,])[Oo]/g, '0')
  .replace(/(?<=\d[.,]\d)[Oo]/g, '0')

/** Deja solo el nombre: sin cantidad inicial, precio unitario, peso ni restos del OCR. */
function limpiarConcepto(texto: string) {
  let c = texto
  let previo
  do {
    previo = c
    c = c.replace(/\s*\d+[.,]\d+\s*(?:x|\*|€|eur)?(?:\s*\/\s*(?:kg|l|uds?))?\s*$/i, '')
  } while (c !== previo)
  // Un peso suelto no es un nombre; "AGUA 1,5 L" sí conserva su formato.
  if (/^[\d.,\s]*(?:kg|g|l|uds?)?\s*$/i.test(c)) return ''
  return c
    .replace(/^\s*\d{1,2}\s*[x*]?\s+/i, '')
    .replace(/^[^\p{L}\d]+|[^\p{L}\d)%]+$/gu, '')
    .replace(/\s{2,}/g, ' ')
}

function buscarFecha(lineas: string[], hoy: string) {
  for (const linea of lineas) {
    const m = linea.match(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/)
    if (!m) continue
    const [dia, mes] = [Number(m[1]), Number(m[2])]
    const anio = m[3].length === 2 ? `20${m[3]}` : m[3]
    const fecha = `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    const real = new Date(`${fecha}T12:00`)
    // Una fecha imposible o futura es un error de lectura.
    if (mes >= 1 && mes <= 12 && real.getDate() === dia && fecha <= hoy) return fecha
  }
}

export function interpretarTicket(texto: string, hoy = isoDia()): TicketLeido {
  const filas = texto.split('\n').map((l) => corregirCeros(l.trim())).filter(Boolean)
  const resultado: TicketLeido = { fecha: buscarFecha(filas, hoy), lineas: [] }
  let pendiente: string | undefined // nombre en una fila y su importe en la siguiente (productos a peso)

  for (const fila of filas) {
    const norm = mayusculas(fila)
    const m = fila.match(IMPORTE_FINAL)

    if (m && TOTAL.test(norm) && !NO_ES_TOTAL.test(norm)) {
      resultado.total = Number(`${m[2]}.${m[3]}`)
      break // lo que sigue son impuestos y datos del pago
    }
    if (NO_ES_PRODUCTO.test(norm)) continue

    if (!m) {
      const nombre = limpiarConcepto(fila)
      if (letras(nombre) >= 3) {
        pendiente = nombre
        if (!resultado.lineas.length && !resultado.comercio) {
          resultado.comercio = nombre.replace(/[,\s]+S\.?\s?[AL]\.?(?:\s?U\.?)?$/i, '').trim()
        }
      }
      continue
    }

    let importe = Number(`${m[2]}.${m[3]}`)
    if (m[1] || m[4]) importe = -importe
    const resto = fila.slice(0, m.index).trim()
    const concepto = limpiarConcepto(resto)

    if (letras(concepto) >= 2 && !/^x$/i.test(concepto)) {
      resultado.lineas.push({ concepto, importe })
    } else if (pendiente) {
      // "2 x 1,50" indica el precio unitario; "0,812 kg 1,99 1,62" ya trae el importe final.
      const unidades = resto.match(/^(\d+)\s*[x*]$/i)
      resultado.lineas.push({ concepto: pendiente, importe: redondear(importe * (unidades ? Number(unidades[1]) : 1)) })
    }
    // Sin nombre pendiente es el detalle de la línea anterior, que ya tiene su importe.
    pendiente = undefined
  }
  return resultado
}

export const sumaLineas = (lineas: { importe: number }[]) => redondear(lineas.reduce((s, l) => s + l.importe, 0))

/** Admite "1,50", "1.50" y "-0,30". Devuelve NaN si no es un número. */
export const aNumero = (texto: string) => Number(texto.trim().replace(',', '.') || NaN)
