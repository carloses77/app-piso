// Copia a public/ocr los recursos de lectura de PDF y OCR para servirlos desde la propia app.
// Así el extracto se procesa en el dispositivo, sin pedir nada a un CDN.
import { cp, mkdir, rm } from 'node:fs/promises'

const dest = 'public/ocr'
const nm = 'node_modules'
await rm(dest, { recursive: true, force: true })
await mkdir(dest, { recursive: true })
const archivos = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/spa/4.0.0/spa.traineddata.gz', 'spa.traineddata.gz'],
]
for (const [origen, nombre] of archivos) await cp(`${nm}/${origen}`, `${dest}/${nombre}`)
await cp(`${nm}/pdfjs-dist/wasm`, `${dest}/pdfjs-wasm`, { recursive: true })
await cp(`${nm}/pdfjs-dist/standard_fonts`, `${dest}/pdfjs-fuentes`, { recursive: true })
