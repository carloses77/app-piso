import { describe, it, expect, beforeEach } from 'vitest'
import { db, type Limpieza, type Aparcamiento } from '../db'
import { asegurarPeriodo, guardar } from '../db/operaciones'
import { generarRecurrentes, fechaRecurrente } from './recurrentes'
import { turnoSemana, puntosLimpieza, lunesIso, sumarDias, conteoParkingMes } from './calculos'
import { calcularAvisos } from './avisos'
import { consumos } from '../pages/Contadores'

const alias = { A: 'Ana', B: 'Bea' }

describe('pagos recurrentes', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  it('ajusta el día a meses cortos', () => {
    expect(fechaRecurrente({ dia: 31 }, '2026-02')).toBe('2026-02-28')
  })
  it('genera una sola vez por mes (idempotente)', async () => {
    await asegurarPeriodo()
    await guardar('recurrentes', { tipo: 'renta', concepto: 'Alquiler', importe: 900, dia: 1, pagadoPor: 'A', partePagador: 50, activo: true }, 'x')
    expect(await generarRecurrentes('2026-11')).toBe(1)
    expect(await generarRecurrentes('2026-11')).toBe(0)
    expect(await generarRecurrentes('2026-12')).toBe(1)
    expect(await db.pagos.count()).toBe(2)
  })
})

describe('limpieza', () => {
  it('pasa el turno al otro si quien le toca está de vacaciones', () => {
    const f = new Date('2026-10-20T12:00')
    const base = turnoSemana(f, 0)
    const aus = { [base]: { desde: '2026-10-01', hasta: '2026-10-31' } }
    expect(turnoSemana(f, 0, aus)).not.toBe(base)
  })
  it('cuenta puntos y racha de semanas seguidas', () => {
    const hoy = lunesIso(new Date())
    const l = (fecha: string, zona = 'Cocina'): Limpieza => ({ id: fecha + zona, actualizado: 0, periodoId: 'x', zona, fecha, asignadoA: 'A', hecho: true })
    const xs = [l(hoy), l(hoy, 'Baño'), l(sumarDias(hoy, -7)), l(sumarDias(hoy, -21))]
    const r = puntosLimpieza(xs, 'A')
    expect(r.puntos).toBe(40)
    expect(r.racha).toBe(2)
  })
})

describe('parking', () => {
  it('las reservas futuras no cuentan como aparcamiento', () => {
    const a = (fecha: string, reserva = false): Aparcamiento => ({ id: fecha, actualizado: 0, periodoId: 'x', fecha, usuario: 'A', reserva })
    expect(conteoParkingMes([a('2026-10-10'), a('2026-10-25', true)], '2026-10', '2026-10-19')).toEqual({ A: 1, B: 0 })
  })
})

describe('avisos', () => {
  it('avisa del alquiler que vence mañana y de la reserva del otro', () => {
    const hoy = new Date('2026-10-30T10:00')
    const avisos = calcularAvisos({
      yo: 'A', alias, hoy, pagos: [], limpiezas: [], compra: [], ausencias: {},
      recurrentes: [{ id: 'r1', actualizado: 0, tipo: 'renta', concepto: 'Alquiler', importe: 900, dia: 31, pagadoPor: 'A', partePagador: 50, activo: true }],
      parking: [{ id: 'p', actualizado: 0, periodoId: 'x', fecha: '2026-10-31', usuario: 'B', reserva: true }],
    })
    expect(avisos.find((a) => a.id === 'rec-r1')?.texto).toBe('Alquiler vence mañana')
    expect(avisos.find((a) => a.id === 'parking')?.texto).toContain('Bea')
  })
})

describe('avisos de limpieza reasignada', () => {
  it('sigue a quien tiene la zona asignada, no al turno calculado', () => {
    const hoy = new Date('2026-11-05T10:00')
    const sem = lunesIso(hoy)
    const base = { alias, hoy, pagos: [], compra: [], ausencias: {}, recurrentes: [], parking: [] }
    const zona = 'Cocina'
    const turno = turnoSemana(hoy, 0, {})
    const otro = turno === 'A' ? 'B' as const : 'A' as const
    const limpiezas: Limpieza[] = [{ id: 'l', actualizado: 0, periodoId: 'x', zona, fecha: sem, asignadoA: otro, hecho: false }]
    expect(calcularAvisos({ ...base, yo: otro, limpiezas }).find((a) => a.id === 'limpieza')?.texto).toContain(zona)
    expect(calcularAvisos({ ...base, yo: turno, limpiezas }).find((a) => a.id === 'limpieza')?.texto ?? '').not.toContain(zona)
  })
})

describe('contadores', () => {
  it('calcula el consumo entre lecturas', () => {
    const l = (fecha: string, valor: number) => ({ id: fecha, actualizado: 0, tipo: 'luz' as const, fecha, valor })
    const r = consumos([l('2026-10-01', 1000), l('2026-09-01', 800)])
    expect(r).toHaveLength(1)
    expect(r[0].consumo).toBe(200)
    expect(r[0].dias).toBe(30)
  })
})
