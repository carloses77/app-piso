// Lectura local del PDF: usa el texto del documento y recurre al OCR solo en páginas escaneadas.
// Nada sale del dispositivo: todos los recursos se sirven desde la propia app (public/ocr).
import type { Celda, LineaPdf } from './banco'

const RECURSOS = `${import.meta.env.BASE_URL}ocr`
const MIN_CARACTERES_PAGINA = 40
const ESCALA_OCR = 2.5

export interface Progreso { texto: string; porcentaje: number }

async function cargarPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

export async function abrirPdf(datos: Uint8Array) {
  const pdfjs = await cargarPdfjs()
  try {
    // pdf.js puede transferir el buffer al worker: se le pasa una copia.
    return await pdfjs.getDocument({
      data: datos.slice(),
      wasmUrl: `${RECURSOS}/pdfjs-wasm/`,
      standardFontDataUrl: `${RECURSOS}/pdfjs-fuentes/`,
    }).promise
  } catch (e) {
    if ((e as Error).name === 'PasswordException') throw new Error('El PDF tiene contraseña. Descárgalo sin protección y vuelve a subirlo.')
    throw new Error('No se ha podido abrir el archivo como PDF.')
  }
}

type DocumentoPdf = Awaited<ReturnType<typeof abrirPdf>>
type PaginaPdf = Awaited<ReturnType<DocumentoPdf['getPage']>>

export async function pintarPagina(pagina: PaginaPdf, canvas: HTMLCanvasElement, escala: number) {
  const viewport = pagina.getViewport({ scale: escala })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await pagina.render({ canvas, viewport }).promise
}

/** Agrupa fragmentos de texto en líneas según su posición vertical. */
function agrupar(fragmentos: (Celda & { y: number })[], tolerancia: number): LineaPdf[] {
  const ordenados = [...fragmentos].sort((a, b) => a.y - b.y)
  const grupos: (Celda & { y: number })[][] = []
  for (const f of ordenados) {
    const g = grupos.at(-1)
    if (g && Math.abs(g[0].y - f.y) <= tolerancia) g.push(f)
    else grupos.push([f])
  }
  return grupos.map((g) => g.sort((a, b) => a.x - b.x).map(({ x, ancho, texto }) => ({ x, ancho, texto, y: g[0].y })))
}

async function lineasDeTexto(pagina: PaginaPdf, desplazamiento: number) {
  const { items } = await pagina.getTextContent()
  const alto = pagina.getViewport({ scale: 1 }).height
  const fragmentos: (Celda & { y: number })[] = []
  for (const it of items) {
    if (!('str' in it) || !it.str.trim()) continue
    // El texto vertical del margen (datos registrales) no forma parte del documento.
    if (Math.abs(it.transform[1]) > 0.01) continue
    fragmentos.push({ x: it.transform[4], ancho: it.width, texto: it.str, y: desplazamiento + alto - it.transform[5] })
  }
  return { lineas: agrupar(fragmentos, 3), caracteres: fragmentos.reduce((s, f) => s + f.texto.length, 0) }
}

type TrabajadorOcr = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>

async function lineasDeOcr(pagina: PaginaPdf, ocr: TrabajadorOcr, desplazamiento: number): Promise<LineaPdf[]> {
  const canvas = document.createElement('canvas')
  await pintarPagina(pagina, canvas, ESCALA_OCR)
  const { data } = await ocr.recognize(canvas, {}, { blocks: true })
  const lineas: LineaPdf[] = []
  for (const bloque of data.blocks ?? []) {
    for (const parrafo of bloque.paragraphs) {
      for (const linea of parrafo.lines) {
        lineas.push(linea.words.map((w) => ({ x: w.bbox.x0, ancho: w.bbox.x1 - w.bbox.x0, texto: w.text, y: desplazamiento + linea.bbox.y0 / ESCALA_OCR })))
      }
    }
  }
  canvas.width = canvas.height = 0
  return lineas
}

export async function extraerLineas(datos: Uint8Array, avisar: (p: Progreso) => void) {
  avisar({ texto: 'Abriendo el PDF…', porcentaje: 3 })
  const doc = await abrirPdf(datos)
  let ocr: TrabajadorOcr | undefined
  let usoOcr = false
  const lineas: LineaPdf[] = []
  // Cada página continúa la anterior para que sus filas no se mezclen.
  let desplazamiento = 0
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const base = ((n - 1) / doc.numPages) * 100
      avisar({ texto: `Leyendo página ${n} de ${doc.numPages}…`, porcentaje: Math.max(5, base) })
      const pagina = await doc.getPage(n)
      const leido = await lineasDeTexto(pagina, desplazamiento)
      const altoPagina = pagina.getViewport({ scale: 1 }).height
      if (leido.caracteres >= MIN_CARACTERES_PAGINA) {
        lineas.push(...leido.lineas)
        desplazamiento += altoPagina
        continue
      }
      usoOcr = true
      avisar({ texto: `Aplicando OCR a la página ${n} de ${doc.numPages}…`, porcentaje: Math.max(5, base) })
      if (!ocr) {
        const { createWorker, OEM } = await import('tesseract.js')
        ocr = await createWorker('spa', OEM.LSTM_ONLY, {
          workerPath: `${RECURSOS}/worker.min.js`,
          corePath: RECURSOS,
          langPath: RECURSOS,
          workerBlobURL: false,
          gzip: true,
        })
      }
      lineas.push(...(await lineasDeOcr(pagina, ocr, desplazamiento)))
      desplazamiento += altoPagina
    }
  } finally {
    await ocr?.terminate()
    await doc.destroy()
  }
  return { lineas, metodo: usoOcr ? ('ocr' as const) : ('texto' as const) }
}
