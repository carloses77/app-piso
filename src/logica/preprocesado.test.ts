import { describe, it, expect } from 'vitest'
import { estimarInclinacion, estirarContraste, umbralAdaptativo } from './preprocesado'

describe('preprocesado de la foto', () => {
  it('conserva el texto tanto en la zona clara como en la sombra', () => {
    const [an, al] = [200, 60]
    const g = new Uint8ClampedArray(an * al)
    for (let y = 0; y < al; y++) for (let x = 0; x < an; x++) {
      const fondo = x < 100 ? 240 : 90 // media foto en sombra
      g[y * an + x] = y >= 28 && y <= 31 && x % 12 < 5 ? fondo * 0.45 : fondo
    }
    const b = umbralAdaptativo(g, an, al)
    expect(b[30 * an + 24]).toBe(0)
    expect(b[30 * an + 144]).toBe(0)
    expect(b[10 * an + 24]).toBe(255)
    expect(b[10 * an + 144]).toBe(255)
  })

  it('estira el contraste de una imagen apagada', () => {
    const g = new Uint8ClampedArray(1000).map((_, i) => (i % 2 ? 150 : 100))
    const r = estirarContraste(g)
    expect(Math.min(...r)).toBe(0)
    expect(Math.max(...r)).toBe(255)
  })

  it.each([0, 4, -5])('detecta una inclinación de %d grados', (grados) => {
    const [an, al] = [300, 300]
    const g = new Uint8ClampedArray(an * al).fill(230)
    const t = Math.tan((grados * Math.PI) / 180)
    for (let f = 40; f < 270; f += 24) for (let x = 0; x < an; x++) {
      const y = Math.round(f + x * t)
      if (y >= 0 && y < al - 2) { g[y * an + x] = 20; g[(y + 1) * an + x] = 20 }
    }
    expect(Math.abs(estimarInclinacion(g, an, al) - grados)).toBeLessThanOrEqual(0.5)
  })
})
