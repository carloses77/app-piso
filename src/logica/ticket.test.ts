import { describe, it, expect } from 'vitest'
import { aNumero, calidadLectura, cuadraTicket, interpretarTicket, sumaLineas } from './ticket'

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

describe('errores frecuentes en fotos reales', () => {
  it('corrige letras leídas dentro del importe', () => {
    const { lineas } = interpretarTicket('LECHE l,50\nPAN 1,S0\nHUEVOS 2.B0\nTOTAL 5,80', HOY)
    expect(lineas.map((l) => l.importe)).toEqual([1.5, 1.5, 2.8])
  })

  it('acepta otros separadores y ruido al final de la fila', () => {
    const { lineas } = interpretarTicket("LECHE 0'85 |\nPAN 1,20 _\nFRUTA 2,10 10%\nTOTAL 4,15 ;", HOY)
    expect(lineas.map((l) => l.importe)).toEqual([0.85, 1.2, 2.1])
  })

  it('recupera la coma perdida solo dentro de los productos', () => {
    const t = interpretarTicket('MAYOR 12 08\nLECHE 0,85\nPAN 1 20\nTOTAL 2,05', HOY)
    expect(t.lineas).toEqual([{ concepto: 'LECHE', importe: 0.85 }, { concepto: 'PAN', importe: 1.2 }])
  })

  it('lee el total aunque la cantidad esté en la fila siguiente', () => {
    const t = interpretarTicket('LECHE 0,85\nTOTAL COMPRA\n0,85\nOTRA COSA 9,99', HOY)
    expect(t.lineas).toHaveLength(1)
    expect(t.total).toBe(0.85)
  })

  it('no se detiene en "SUB TOTAL" y entiende "A PAGAR"', () => {
    const t = interpretarTicket('LECHE 0,85\nSUB TOTAL 0,85\nPAN 1,00\nA PAGAR 1,85', HOY)
    expect(t.lineas).toHaveLength(2)
    expect(t.total).toBe(1.85)
  })

  it('usa el cobro con tarjeta si no hay total legible', () => {
    expect(interpretarTicket('LECHE 0,85\nTARJETA 0,85', HOY).total).toBe(0.85)
  })

  it('no toma la hora ni la cabecera como producto', () => {
    const t = interpretarTicket('C/ MAYOR 1\n03/11/2026 18.30\nLECHE 0,85\nTOTAL 0,85', HOY)
    expect(t.lineas).toEqual([{ concepto: 'LECHE', importe: 0.85 }])
  })

  it('prefiere la lectura cuyas líneas suman el total', () => {
    const buena = interpretarTicket('LECHE 0,85\nPAN 1,00\nTOTAL 1,85', HOY)
    const mala = interpretarTicket('LECHE 0,85\nPAN 7,00\nGOMA 1,00\nTOTAL 1,85', HOY)
    expect(cuadraTicket(buena)).toBe(true)
    expect(calidadLectura(buena)).toBeGreaterThan(calidadLectura(mala))
  })
})

describe('aNumero', () => {
  it('acepta coma, punto y negativos', () => {
    expect(aNumero('1,50')).toBe(1.5)
    expect(aNumero('-0.30')).toBe(-0.3)
    expect(aNumero('')).toBeNaN()
  })
})
