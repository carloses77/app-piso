import { describe, it, expect } from 'vitest'
import { agruparPorSemana, calcularBalance, categorizar, destacados, detectarAportante, interpretarExtracto, interpretarRecibo, leerImporte, saldosDeSemana, saltoDeSaldo, yaRegistrado, type LineaPdf } from './banco'
import { lunesIso } from './calculos'

let n = 0
const id = () => `m${n++}`
const l = (...t: (string | [number, string])[]): LineaPdf =>
  t.map((c, i) => (typeof c === 'string' ? { x: i * 100, ancho: 50, texto: c } : { x: c[0], ancho: 50, texto: c[1] }))

describe('importes', () => {
  it('entiende los formatos habituales', () => {
    expect(leerImporte('1.234,56')?.valor).toBe(1234.56)
    expect(leerImporte('1,234.56')?.valor).toBe(1234.56)
    expect(leerImporte('45,00-')?.valor).toBe(-45)
    expect(leerImporte('−45,00')?.valor).toBe(-45)
  })
})

describe('extractos', () => {
  it('lee importes con signo y saldo, y completa la continuación del concepto', () => {
    const r = interpretarExtracto([
      l('Extracto del 02/11/2026 al 08/11/2026'),
      l('Saldo anterior', '1.000,00'),
      l('Fecha', 'Concepto', 'Importe', 'Saldo'),
      l('02/11/2026', 'Transferencia Ana', '500,00', '1.500,00'),
      l('03/11/2026', 'Recibo alquiler', '-900,00', '600,00'),
      l('noviembre piso'),
      l('Saldo final', '600,00'),
    ], id)
    expect(r.desde).toBe('2026-11-02')
    expect(r.hasta).toBe('2026-11-08')
    expect(r.saldoInicial).toBe(1000)
    expect(r.saldoFinal).toBe(600)
    expect(r.movimientos.map((m) => m.importe)).toEqual([500, -900])
    expect(r.movimientos[1].concepto).toBe('Recibo alquiler noviembre piso')
    expect(r.movimientos.every((m) => !m.dudoso)).toBe(true)
  })

  it('deduce el signo por las columnas Debe y Haber', () => {
    const r = interpretarExtracto([
      l([0, 'Fecha'], [100, 'Concepto'], [300, 'Debe'], [400, 'Haber']),
      l([0, '02/11/2026'], [100, 'Luz'], [300, '60,00']),
      l([0, '03/11/2026'], [100, 'Aportación'], [400, '200,00']),
    ], id)
    expect(r.movimientos.map((m) => m.importe)).toEqual([-60, 200])
  })

  it('deduce el signo por el saldo y ordena las fechas de forma cronológica', () => {
    const r = interpretarExtracto([
      l('Saldo anterior', '100,00'),
      l('04/11/2026', 'Movimiento B', '30,00', '120,00'),
      l('03/11/2026', 'Movimiento A', '50,00', '150,00'),
    ], id)
    expect(r.movimientos.map((m) => [m.concepto, m.importe])).toEqual([['Movimiento A', 50], ['Movimiento B', -30]])
    expect(r.movimientos.some((m) => m.dudoso)).toBe(false)
  })

  it('marca como dudoso lo que no cuadra con el saldo o no tiene signo', () => {
    const r = interpretarExtracto([
      l('Saldo anterior', '100,00'),
      l('03/11/2026', 'Error OCR', '-99,00', '50,00'),
    ], id)
    expect(r.movimientos[0].dudoso).toBe(true)
    const sinSigno = interpretarExtracto([l('04/11/2026', 'Sin saldo', '10,00')], id)
    expect(sinSigno.movimientos[0].dudoso).toBe(true)
  })

  it('entiende que sin signo es ingreso si los cargos llevan "-"', () => {
    const r = interpretarExtracto([
      l('04/11/2026', 'Cargo', '-10,00', '90,00'),
      l('03/11/2026', 'Devolución', '97,57', '100,00'),
    ], id)
    expect(r.movimientos.map((m) => m.importe)).toEqual([97.57, -10])
    expect(r.movimientos.some((m) => m.dudoso)).toBe(false)
  })
})

describe('recibos', () => {
  // Misma estructura que un adeudo real, con datos inventados.
  const adeudo = [
    l('ADEUDO POR DOMICILIACIÓN'),
    l('OFICINA:', '0001'),
    l('FECHA:', '04-11-2026'),
    l('ENTIDAD ORDENANTE', 'ID.EMISOR', 'REFERENCIA:'),
    l('GESTORA EJEMPLO S.L.', 'ES00000', '11-1A'),
    l('Rec.: No 11-22 Fecha: 01/11/2026 Alquiler', '11 1A Calle Falsa 1'),
    l('IMPORTE TOTAL', 'EUR', 'FECHA VALOR'),
    l('1.500,00'),
  ]
  it('convierte un adeudo en un único gasto', () => {
    expect(interpretarExtracto(adeudo, id).movimientos).toEqual([])
    const r = interpretarRecibo(adeudo, id)!
    expect(r.desde).toBe('2026-11-04')
    expect(r.movimientos).toHaveLength(1)
    expect(r.movimientos[0]).toMatchObject({ fecha: '2026-11-04', importe: -1500, concepto: 'Alquiler · GESTORA EJEMPLO S.L.' })
    expect(categorizar(r.movimientos[0].concepto, r.movimientos[0].importe)).toBe('renta')
  })
  it('no inventa datos si el documento no es un recibo', () => {
    expect(interpretarRecibo([l('Un documento cualquiera', '10,00')], id)).toBeUndefined()
  })
})

describe('balance', () => {
  const movs = [
    { id: '1', fecha: '2026-11-02', concepto: 'Bizum Ana', importe: 500, aportadoPor: 'A' as const },
    { id: '2', fecha: '2026-11-03', concepto: 'Alquiler', importe: -450 },
    { id: '3', fecha: '2026-11-04', concepto: 'Comisión mantenimiento', importe: -5 },
    { id: '4', fecha: '2026-11-04', concepto: 'Borrado', importe: -999, borrado: true },
  ]
  it('calcula totales y comprueba si cuadra', () => {
    expect(calcularBalance(movs, 100, 145)).toMatchObject({ ingresos: 500, gastos: 455, neto: 45, cuadra: true })
    expect(calcularBalance(movs, 100, 150)).toMatchObject({ cuadra: false, diferencia: -5 })
    expect(calcularBalance(movs).cuadra).toBeUndefined()
  })
  it('obtiene los destacados', () => {
    const d = destacados(movs)
    expect(d.mayorIngreso.id).toBe('1')
    expect(d.mayorGasto.id).toBe('2')
    expect(d.comisiones).toBe(5)
    expect(d.aportes.A).toBe(500)
  })
  it('agrupa por semana de lunes a domingo', () => {
    const lunes = (f: string) => lunesIso(new Date(f + 'T12:00'))
    const s = agruparPorSemana([{ fecha: '2026-11-08' }, { fecha: '2026-11-09' }, { fecha: '2026-11-02' }], lunes)
    expect(s.map((x) => [x.lunes, x.movimientos.length])).toEqual([['2026-11-09', 1], ['2026-11-02', 2]])
  })
  it('detecta saltos de saldo y aportantes', () => {
    expect(saltoDeSaldo({ saldoFinal: 100 }, { saldoInicial: 100 })).toBeUndefined()
    expect(saltoDeSaldo({ saldoFinal: 100 }, { saldoInicial: 80 })).toBe(-20)
    expect(detectarAportante('BIZUM DE ANA', { A: 'Ana', B: 'Bea' })).toBe('A')
    expect(detectarAportante('BIZUM', { A: 'Compi 1', B: 'Compi 2' })).toBeUndefined()
  })
})

describe('extracto con concepto partido en varias líneas', () => {
  const c = (x: number, y: number, texto: string) => ({ x, y, ancho: 60, texto })
  const lineas: LineaPdf[] = [
    [c(0, 10, 'Operación'), c(70, 10, 'Fecha Valor'), c(200, 10, 'Concepto'), c(400, 10, 'Importe'), c(480, 10, 'Saldo')],
    [c(200, 30, 'RECIBO EMPRESA')],
    [c(0, 36, '05/11/2026'), c(70, 36, '05/11/2026'), c(400, 36, '-10,00 EUR'), c(480, 36, '90,00 EUR')],
    [c(200, 42, 'REF 123')],
    [c(200, 60, 'CAJERO TARJETA')],
    [c(0, 66, '04/11/2026'), c(70, 66, '04/11/2026'), c(200, 66, '5489133200000000, COMISION 2,95'), c(400, 66, '-42,95 EUR'), c(480, 66, '100,00 EUR')],
    [c(200, 72, 'EL 2026-11-04')],
  ]
  it('une los fragmentos, ignora cifras del concepto y oculta la tarjeta', () => {
    const r = interpretarExtracto(lineas, id)
    expect(r.movimientos.map((m) => m.importe)).toEqual([-42.95, -10])
    expect(r.movimientos[1].concepto).toBe('RECIBO EMPRESA REF 123')
    expect(r.movimientos[0].concepto).toContain('····0000')
    expect(r.movimientos[0].concepto).not.toContain('5489133200000000')
    expect(r.movimientos[0].concepto).toContain('EL 2026-11-04')
    expect(r.saldoFinal).toBe(90)
  })
  it('detecta duplicados y calcula saldos por semana', () => {
    expect(yaRegistrado({ fecha: '2026-11-04', importe: -5 }, [{ fecha: '2026-11-04', importe: -5, saldo: 1 }])).toBe(true)
    expect(yaRegistrado({ fecha: '2026-11-04', importe: -5, saldo: 2 }, [{ fecha: '2026-11-04', importe: -5, saldo: 1 }])).toBe(false)
    expect(saldosDeSemana([{ fecha: '2026-11-04', importe: -5, saldo: 95, orden: 1 }, { fecha: '2026-11-04', importe: 50, saldo: 100, orden: 0 }])).toEqual({ saldoInicial: 50, saldoFinal: 95 })
  })
})
