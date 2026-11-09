// OCR de la foto de un ticket, siempre en el dispositivo: la imagen no sale de aquí para leerla.
import { crearOcr, type Progreso } from './lectorPdf'
import { calidadLectura, cuadraTicket, interpretarTicket, type TicketLeido } from './ticket'
import { estimarInclinacion, estirarContraste, umbralAdaptativo } from './preprocesado'

const LADO_OBJETIVO = 2200
const MAX_LADO_OCR = 2800
const LADO_INCLINACION = 700

type Modo = 'adaptativo' | 'contraste'
interface Intento { modo: Modo; psm: string; giro: number }

function lienzoNuevo(ancho: number, alto: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(ancho))
  c.height = Math.max(1, Math.round(alto))
  return c
}

function aGris(ctx: CanvasRenderingContext2D, ancho: number, alto: number) {
  const px = ctx.getImageData(0, 0, ancho, alto).data
  const gris = new Uint8ClampedArray(ancho * alto)
  for (let i = 0; i < gris.length; i++) gris[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000
  return gris
}

function pintarGris(ctx: CanvasRenderingContext2D, gris: Uint8ClampedArray, ancho: number, alto: number) {
  const img = ctx.createImageData(ancho, alto)
  for (let i = 0; i < gris.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = gris[i]
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

/** Lienzo a tamaño útil, girado y enderezado. Amplía las fotos pequeñas: el texto fino se lee mejor. */
function encuadrar(bmp: ImageBitmap, giro: number) {
  const mayor = Math.max(bmp.width, bmp.height)
  const escala = Math.min(MAX_LADO_OCR / mayor, Math.min(2, Math.max(1, LADO_OBJETIVO / mayor)))
  const girado = giro % 180 !== 0
  const [an, al] = [bmp.width * escala, bmp.height * escala]
  const base = lienzoNuevo(girado ? al : an, girado ? an : al)
  const ctx = base.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(base.width / 2, base.height / 2)
  ctx.rotate((giro * Math.PI) / 180)
  ctx.drawImage(bmp, -an / 2, -al / 2, an, al)

  const reduccion = Math.min(1, LADO_INCLINACION / Math.max(base.width, base.height))
  const mini = lienzoNuevo(base.width * reduccion, base.height * reduccion)
  const ctxMini = mini.getContext('2d', { willReadFrequently: true })!
  ctxMini.drawImage(base, 0, 0, mini.width, mini.height)
  const grados = estimarInclinacion(aGris(ctxMini, mini.width, mini.height), mini.width, mini.height)
  mini.width = mini.height = 0
  if (Math.abs(grados) < 1) return base

  const recto = lienzoNuevo(base.width, base.height)
  const ctxRecto = recto.getContext('2d', { willReadFrequently: true })!
  ctxRecto.fillStyle = '#fff'
  ctxRecto.fillRect(0, 0, recto.width, recto.height)
  ctxRecto.translate(recto.width / 2, recto.height / 2)
  ctxRecto.rotate((-grados * Math.PI) / 180)
  ctxRecto.drawImage(base, -base.width / 2, -base.height / 2)
  base.width = base.height = 0
  return recto
}

function prepararFoto(bmp: ImageBitmap, modo: Modo, giro: number) {
  const lienzo = encuadrar(bmp, giro)
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })!
  const gris = aGris(ctx, lienzo.width, lienzo.height)
  pintarGris(ctx, modo === 'adaptativo' ? umbralAdaptativo(gris, lienzo.width, lienzo.height) : estirarContraste(gris), lienzo.width, lienzo.height)
  return lienzo
}

/** Un ticket es alargado: si la foto está apaisada se prueba girada a un lado y al otro. */
function planDeLectura(bmp: ImageBitmap): Intento[] {
  if (bmp.width > bmp.height * 1.15) {
    return [{ modo: 'adaptativo', psm: '4', giro: 90 }, { modo: 'adaptativo', psm: '4', giro: 270 }, { modo: 'contraste', psm: '6', giro: 90 }]
  }
  return [{ modo: 'adaptativo', psm: '4', giro: 0 }, { modo: 'contraste', psm: '6', giro: 0 }, { modo: 'adaptativo', psm: '6', giro: 0 }]
}

export async function leerTicket(archivo: File, avisar: (p: Progreso) => void) {
  avisar({ texto: 'Preparando la foto…', porcentaje: 5 })
  const bmp = await createImageBitmap(archivo)
  const plan = planDeLectura(bmp)
  let actual = 0
  avisar({ texto: 'Cargando el lector…', porcentaje: 10 })
  const ocr = await crearOcr((m) => {
    if (m.status === 'recognizing text') {
      avisar({ texto: actual ? 'Repasando el ticket para afinar…' : 'Leyendo el ticket…', porcentaje: 10 + ((actual + m.progress) / plan.length) * 90 })
    }
  })
  let mejor: TicketLeido = { lineas: [] }
  try {
    for (actual = 0; actual < plan.length; actual++) {
      const { modo, psm, giro } = plan[actual]
      const lienzo = prepararFoto(bmp, modo, giro)
      try {
        await ocr.setParameters({ tessedit_pageseg_mode: psm as never, preserve_interword_spaces: '1', user_defined_dpi: '300' })
        const { data } = await ocr.recognize(lienzo)
        const leido = interpretarTicket(data.text)
        if (calidadLectura(leido) > calidadLectura(mejor)) mejor = leido
      } finally {
        lienzo.width = lienzo.height = 0
      }
      if (cuadraTicket(mejor)) break // las líneas suman el total: no hace falta otra pasada
    }
    return mejor
  } finally {
    bmp.close()
    await ocr.terminate()
  }
}
