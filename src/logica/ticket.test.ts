import { describe, it, expect } from 'vitest'
import { aNumero, interpretarTicket, sumaLineas } from './ticket'

const HOY = '2026-11-05'

describe('interpretarTicket', () => {
  it('lee un ticket de supermercado y se detiene en el total', () => {
    const t = interpretarTicket(`MERCADONA, S.A.
C/ Mayor 1
CIF A-46103834
03/11/2026 18:30
FACTURA SIMPLIFICADA 2345-012-678
1 LECHE ENTERA 0,85
2 PAN DE MOLDE 1,20 2,40
AGUA 1,5 L 0,60
TOTAL (€) 3,85
TARJETA 3,85
IVA 10% 0,35`, HOY)
    expect(t.comercio).toBe('MERCADONA')
    expect(t.fecha).toBe('2026-11-03')
    expect(t.total).toBe(3.85)
    expect(t.lineas).toEqual([
      { concepto: 'LECHE ENTERA', importe: 0.85 },
      { concepto: 'PAN DE MOLDE', importe: 2.4 },
      { concepto: 'AGUA 1,5 L', importe: 0.6 },
    ])
    expect(sumaLineas(t.lineas)).toBe(t.total)
  })

  it('une el nombre con el peso de la fila siguiente', () => {
    const { lineas } = interpretarTicket('PLATANO\n0,812 kg 1,99 €/kg 1,62\nTOTAL 1,62', HOY)
    expect(lineas).toEqual([{ concepto: 'PLATANO', importe: 1.62 }])
  })

  it('multiplica las unidades solo si la línea no tenía importe', () => {
    expect(interpretarTicket('YOGUR\n3 x 0,50', HOY).lineas).toEqual([{ concepto: 'YOGUR', importe: 1.5 }])
    expect(interpretarTicket('YOGUR 1,50 B\n3 x 0,50', HOY).lineas).toEqual([{ concepto: 'YOGUR', importe: 1.5 }])
  })

  it('reconoce descuentos y errores típicos del OCR', () => {
    const { lineas, total } = interpretarTicket('CAFE O,95\nDTO CUPON 0,20-\nACEITE -1,00\nT0TAL 2,5O', HOY)
    expect(lineas).toEqual([
      { concepto: 'CAFE', importe: 0.95 },
      { concepto: 'DTO CUPON', importe: -0.2 },
      { concepto: 'ACEITE', importe: -1 },
    ])
    expect(total).toBe(2.5)
  })

  it('no confunde productos con líneas de pago o impuestos', () => {
    const { lineas, total } = interpretarTicket('BASE PIZZA 1,50\nSUBTOTAL 1,50\nBASE IMP. 1,36\nEFECTIVO 5,00\nCAMBIO 3,50', HOY)
    expect(lineas).toEqual([{ concepto: 'BASE PIZZA', importe: 1.5 }])
    expect(total).toBeUndefined()
  })

  it('ignora fechas imposibles o futuras', () => {
    expect(interpretarTicket('31/02/2026\n01/01/2027\n02-11-26', HOY).fecha).toBe('2026-11-02')
  })

  it('no inventa nada de un texto ilegible', () => {
    expect(interpretarTicket('~~ |||\n\n..', HOY)).toEqual({ fecha: undefined, lineas: [] })
  })
})

describe('aNumero', () => {
  it('acepta coma, punto y negativos', () => {
    expect(aNumero('1,50')).toBe(1.5)
    expect(aNumero('-0.30')).toBe(-0.3)
    expect(aNumero('')).toBeNaN()
  })
})
