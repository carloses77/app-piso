// OCR de la foto de un ticket, siempre en el dispositivo: la imagen no sale de aquí para leerla.
import { crearOcr, type Progreso } from './lectorPdf'
import { interpretarTicket } from './ticket'

const MAX_LADO_OCR = 2400

/** Prepara la foto a mayor resolución que la guardada: pasa a grises y estira el contraste. */
async function prepararFoto(archivo: File) {
  const bmp = await createImageBitmap(archivo)
  const escala = Math.min(1, MAX_LADO_OCR / Math.max(bmp.width, bmp.height))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.round(bmp.width * escala)
  lienzo.height = Math.round(bmp.height * escala)
  const ctx = lienzo.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, lienzo.width, lienzo.height)
  bmp.close()
  const imagen = ctx.getImageData(0, 0, lienzo.width, lienzo.height)
  const px = imagen.data
  let min = 255
  let max = 0
  for (let i = 0; i < px.length; i += 4) {
    const gris = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000
    px[i] = gris
    if (gris < min) min = gris
    if (gris > max) max = gris
  }
  const rango = Math.max(1, max - min)
  for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = ((px[i] - min) * 255) / rango
  ctx.putImageData(imagen, 0, 0)
  return lienzo
}

export async function leerTicket(archivo: File, avisar: (p: Progreso) => void) {
  avisar({ texto: 'Preparando la foto…', porcentaje: 5 })
  const lienzo = await prepararFoto(archivo)
  avisar({ texto: 'Cargando el lector…', porcentaje: 10 })
  const ocr = await crearOcr((m) => {
    if (m.status === 'recognizing text') avisar({ texto: 'Leyendo el ticket…', porcentaje: 10 + m.progress * 90 })
  })
  try {
    // Modo 4: una columna de texto de tamaños variables, la forma habitual de un ticket.
    await ocr.setParameters({ tessedit_pageseg_mode: '4' as never })
    const { data } = await ocr.recognize(lienzo)
    return interpretarTicket(data.text)
  } finally {
    await ocr.terminate()
    lienzo.width = lienzo.height = 0
  }
}
