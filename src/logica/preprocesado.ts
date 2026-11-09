// Tratamiento de la imagen antes del OCR. Trabaja sobre matrices de grises para poder probarlo sin navegador.

/** Blanco y negro según la luz de cada zona: las sombras de una foto no borran el texto. */
export function umbralAdaptativo(gris: Uint8ClampedArray, ancho: number, alto: number, sensibilidad = 0.15) {
  const integral = new Float64Array((ancho + 1) * (alto + 1))
  for (let y = 1; y <= alto; y++) {
    let fila = 0
    for (let x = 1; x <= ancho; x++) {
      fila += gris[(y - 1) * ancho + x - 1]
      integral[y * (ancho + 1) + x] = integral[(y - 1) * (ancho + 1) + x] + fila
    }
  }
  const radio = Math.max(8, Math.floor(ancho / 16))
  const salida = new Uint8ClampedArray(gris.length)
  for (let y = 0; y < alto; y++) {
    const y0 = Math.max(0, y - radio)
    const y1 = Math.min(alto, y + radio + 1)
    for (let x = 0; x < ancho; x++) {
      const x0 = Math.max(0, x - radio)
      const x1 = Math.min(ancho, x + radio + 1)
      const a = ancho + 1
      const suma = integral[y1 * a + x1] - integral[y0 * a + x1] - integral[y1 * a + x0] + integral[y0 * a + x0]
      const media = suma / ((x1 - x0) * (y1 - y0))
      salida[y * ancho + x] = gris[y * ancho + x] < media * (1 - sensibilidad) ? 0 : 255
    }
  }
  return salida
}

/** Estira el contraste ignorando los píxeles extremos (brillos y manchas). */
export function estirarContraste(gris: Uint8ClampedArray) {
  const histo = new Uint32Array(256)
  for (const v of gris) histo[v]++
  const corte = gris.length * 0.01
  let min = 0
  for (let n = 0; min < 254 && (n += histo[min]) < corte;) min++
  let max = 255
  for (let n = 0; max > min + 1 && (n += histo[max]) < corte;) max--
  const rango = max - min
  return gris.map((v) => ((v - min) * 255) / rango)
}

/** Grados que está torcido el texto: busca el ángulo en que las filas quedan mejor alineadas. */
export function estimarInclinacion(gris: Uint8ClampedArray, ancho: number, alto: number, maxGrados = 8) {
  let suma = 0
  for (const v of gris) suma += v
  const umbral = (suma / gris.length) * 0.75
  const oscuros: [number, number][] = []
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) if (gris[y * ancho + x] < umbral) oscuros.push([x, y])
  if (!oscuros.length) return 0
  const margen = Math.ceil(ancho * Math.tan((maxGrados * Math.PI) / 180))
  let mejor = 0
  let mejorPuntos = -1
  for (let g = -maxGrados; g <= maxGrados; g += 0.5) {
    const t = Math.tan((g * Math.PI) / 180)
    const filas = new Float64Array(alto + 2 * margen + 1)
    for (const [x, y] of oscuros) filas[Math.round(y - x * t) + margen]++
    let puntos = 0
    for (let i = 1; i < filas.length; i++) puntos += (filas[i] - filas[i - 1]) ** 2
    if (puntos > mejorPuntos || (puntos === mejorPuntos && Math.abs(g) < Math.abs(mejor))) {
      mejorPuntos = puntos
      mejor = g
    }
  }
  return mejor
}
