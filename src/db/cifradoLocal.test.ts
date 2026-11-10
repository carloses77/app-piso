import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { db } from './index'
import { activarCifradoLocal, olvidarCifradoLocal, cifrarRegistrosAntiguos } from './cifradoLocal'

const raw = new Uint8Array(32).fill(7)
const pago = { id: 'p1', actualizado: 1, periodoId: 'per', tipo: 'luz', concepto: 'Factura secreta', importe: 42.5, fecha: '2026-11-01', pagadoPor: 'A', partePagador: 50, saldado: false, foto: 'data:image/jpeg;base64,SECRETO' }

/** Lo que vería quien copiara la base de datos del móvil: IndexedDB sin la capa de cifrado. */
async function enBruto(tabla: string) {
  const crudo = new Dexie('piso-compartido')
  await crudo.open()
  const filas = await crudo.table(tabla).toArray()
  crudo.close()
  return filas
}

describe('cifrado de los datos del móvil', () => {
  beforeEach(async () => {
    olvidarCifradoLocal()
    await db.delete()
    await db.open()
    await activarCifradoLocal(raw)
  })

  it('no deja importes, conceptos ni fotos en claro', async () => {
    await db.pagos.put(pago as never)
    const [fila] = await enBruto('pagos')
    const texto = JSON.stringify(fila)
    expect(texto).not.toContain('Factura secreta')
    expect(texto).not.toContain('SECRETO')
    expect(texto).not.toContain('42.5')
    expect(fila).toMatchObject({ id: 'p1', periodoId: 'per', fecha: '2026-11-01' }) // índices para buscar
    expect(await db.pagos.get('p1')).toEqual(pago)
  })

  it('las búsquedas, filtros y modificaciones siguen funcionando', async () => {
    await db.pagos.bulkPut([pago, { ...pago, id: 'p2', periodoId: 'otro', concepto: 'Agua' }] as never)
    expect((await db.pagos.where('periodoId').equals('per').toArray()).map((p) => p.concepto)).toEqual(['Factura secreta'])
    expect((await db.pagos.filter((p) => p.concepto === 'Agua').toArray()).map((p) => p.id)).toEqual(['p2'])
    await db.pagos.where('id').equals('p2').modify({ importe: 9 })
    await db.pagos.update('p1', { saldado: true })
    expect((await db.pagos.get('p2'))?.importe).toBe(9)
    expect((await db.pagos.get('p1'))?.saldado).toBe(true)
    expect(JSON.stringify(await enBruto('pagos'))).not.toContain('Agua')
  })

  it('bloqueada no se puede leer ni escribir', async () => {
    await db.tareas.put({ id: 't', actualizado: 1, periodoId: 'per', titulo: 'x', estado: 'pendiente', asignadoA: 'A' })
    olvidarCifradoLocal()
    const leida = await db.tareas.get('t')
    expect(leida).toMatchObject({ id: 't', periodoId: 'per' })
    expect(leida).not.toHaveProperty('titulo')
    await expect(db.tareas.put({ id: 'u', actualizado: 1, periodoId: 'per', titulo: 'y', estado: 'pendiente', asignadoA: 'A' })).rejects.toThrow('bloqueada')
  })

  it('una clave distinta no abre los datos', async () => {
    await db.tareas.put({ id: 't', actualizado: 1, periodoId: 'per', titulo: 'x', estado: 'pendiente', asignadoA: 'A' })
    await activarCifradoLocal(new Uint8Array(32).fill(8))
    await expect(db.tareas.get('t')).rejects.toThrow()
  })

  it('cifra los registros que venían en claro de la versión anterior', async () => {
    const crudo = new Dexie('piso-compartido')
    await crudo.open()
    await crudo.table('compra').put({ id: 'c', actualizado: 1, nombre: 'Leche privada', comprado: false, categoria: 'x', añadidoPor: 'A' })
    crudo.close()
    expect((await db.compra.get('c'))?.nombre).toBe('Leche privada') // se lee aunque esté en claro
    await cifrarRegistrosAntiguos(db)
    expect(JSON.stringify(await enBruto('compra'))).not.toContain('Leche')
    expect((await db.compra.get('c'))?.nombre).toBe('Leche privada')
  })
}, 30_000)
