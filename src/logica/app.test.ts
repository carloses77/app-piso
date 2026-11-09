import { describe, it, expect, beforeEach } from 'vitest'
import { cifrarJSON, descifrarJSON, derivarClave, aleatorio, importarClaveHogar, generarClaveHogar } from '../cripto'
import { calcularSaldo, conteoParkingMes, turnoSemana } from './calculos'
import { db, type Pago, type Aparcamiento } from '../db'
import { guardar, aplicarRemoto, asegurarPeriodo, renovarPeriodo, periodoActivo } from '../db/operaciones'
import { crearHogar, desbloquear, generarInvitacion, unirseConInvitacion, recuperarConClaveInicial, generarClaveInicial } from '../cripto/sesion'

const pago = (p: Partial<Pago>): Pago => ({
  id: crypto.randomUUID(), actualizado: 0, periodoId: 'x', tipo: 'luz', concepto: '', importe: 100,
  fecha: '2026-10-01', pagadoPor: 'A', partePagador: 50, saldado: false, ...p,
})

describe('cripto', () => {
  it('cifra y descifra ida y vuelta', async () => {
    const k = await importarClaveHogar(generarClaveHogar())
    const txt = await cifrarJSON(k, { hola: 'mundo' })
    expect(txt).not.toContain('mundo')
    expect(await descifrarJSON(k, txt)).toEqual({ hola: 'mundo' })
  })
  it('rechaza una clave incorrecta', async () => {
    const salt = aleatorio(16)
    const buena = await derivarClave('secreto1', salt)
    const mala = await derivarClave('secreto2', salt)
    const txt = await cifrarJSON(buena, 1)
    await expect(descifrarJSON(mala, txt)).rejects.toThrow()
  })
})

describe('cálculos', () => {
  it('saldo a partes iguales y personalizado', () => {
    expect(calcularSaldo([pago({ importe: 100 })])).toBe(50)
    expect(calcularSaldo([pago({ importe: 100, pagadoPor: 'B', partePagador: 30 })])).toBe(-70)
    expect(calcularSaldo([pago({ saldado: true })], 10)).toBe(10)
  })
  it('cuenta el parking por mes y usuario', () => {
    const r = (fecha: string, usuario: 'A' | 'B'): Aparcamiento => ({ id: fecha + usuario, actualizado: 0, periodoId: 'x', fecha, usuario })
    expect(conteoParkingMes([r('2026-10-01', 'A'), r('2026-10-02', 'B'), r('2026-10-03', 'A'), r('2026-11-01', 'A')], '2026-10')).toEqual({ A: 2, B: 1 })
  })
  it('alterna la limpieza semana a semana', () => {
    const f = new Date('2026-10-19')
    const sig = new Date('2026-10-26')
    expect(turnoSemana(f, 0)).not.toBe(turnoSemana(sig, 0))
    expect(turnoSemana(f, 0)).not.toBe(turnoSemana(f, 1))
  })
})

describe('base de datos', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  it('renueva el periodo arrastrando saldo', async () => {
    const p1 = await asegurarPeriodo(new Date('2026-01-01'))
    expect(p1.fin).toBe('2026-12-31')
    await renovarPeriodo(25, new Date('2027-01-01'))
    const act = await periodoActivo()
    expect(act?.saldoArrastrado).toBe(25)
    expect((await db.periodos.toArray()).filter((p) => p.activo)).toHaveLength(1)
    expect(await db.historial.count()).toBe(3)
  })
  it('last-write-wins al aplicar eventos remotos', async () => {
    const id = await guardar('tareas', { titulo: 'local', periodoId: 'x', estado: 'pendiente', asignadoA: 'A' }, 't')
    await aplicarRemoto('tareas', { id, actualizado: 1, titulo: 'viejo' } as never)
    expect((await db.tareas.get(id))?.titulo).toBe('local')
    await aplicarRemoto('tareas', { id, actualizado: Date.now() + 1000, titulo: 'nuevo' } as never)
    expect((await db.tareas.get(id))?.titulo).toBe('nuevo')
  })
  it('emparejamiento y desbloqueo con clave personal', async () => {
    const a = await crearHogar('claveA123', 'ABCD-EFGH-JKMN-PQRS')
    const inv = await generarInvitacion('claveA123')
    await expect(desbloquear('mala-clave')).rejects.toThrow('Clave incorrecta')
    const s = await desbloquear('claveA123')
    expect(s.hogarId).toBe(a.hogarId)
    // B se une en "otro dispositivo" (simulado reseteando la BD)
    await db.delete(); await db.open()
    const b = await unirseConInvitacion(inv, 'claveB999', 'WXYZ-2345-6789-ABCD')
    expect(b.rol).toBe('B')
    expect(b.hogarId).toBe(a.hogarId)
    await expect(desbloquear('claveA123')).rejects.toThrow()
  })

  it('un móvil trasladado conserva su rol', async () => {
    await crearHogar('claveA123', 'ABCD-EFGH-JKMN-PQRS')
    const inv = await generarInvitacion('claveA123')
    await db.delete(); await db.open()
    const a = await unirseConInvitacion(inv, 'claveNueva1', 'WXYZ-2345-6789-ABCD', 'A')
    expect(a.rol).toBe('A')
    expect((await desbloquear('claveNueva1')).rol).toBe('A')
  })
  it('recupera el acceso con la clave inicial', async () => {
    await crearHogar('vieja-clave', 'ABCD-EFGH-JKMN-PQRS')
    await expect(recuperarConClaveInicial('ZZZZ-ZZZZ-ZZZZ-ZZZZ', 'nueva-clave')).rejects.toThrow('Clave inicial incorrecta')
    await recuperarConClaveInicial('abcd efgh jkmn pqrs', 'nueva-clave') // tolera minúsculas y espacios
    await expect(desbloquear('vieja-clave')).rejects.toThrow()
    expect((await desbloquear('nueva-clave')).rol).toBe('A')
  })
  it('genera claves iniciales legibles', () => {
    expect(generarClaveInicial()).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/)
  })
}, 60_000)
