// Carga de partes de la app que solo se descargan al usarlas (lector de PDF, OCR).
// Tras una actualización, una pestaña abierta con la versión anterior pide archivos que ya no existen
// en el servidor («Importing a module script failed»). En ese caso se recarga una vez con la versión nueva.
const MARCA = 'recarga-por-modulo'

const esFalloDeCarga = (e: unknown) =>
  /module script|dynamically imported module|Failed to fetch|Importing a module|error loading/i.test(String((e as Error)?.message ?? e))

export async function importarSeguro<T>(cargar: () => Promise<T>): Promise<T> {
  try {
    const m = await cargar()
    try { sessionStorage.removeItem(MARCA) } catch { /* sin storage */ }
    return m
  } catch (e) {
    if (!esFalloDeCarga(e)) throw e
    let yaRecargada = false
    try { yaRecargada = sessionStorage.getItem(MARCA) === '1'; sessionStorage.setItem(MARCA, '1') } catch { /* sin storage */ }
    if (!yaRecargada) {
      location.reload()
      return new Promise<T>(() => {}) // la página se recarga
    }
    throw new Error('No se pudo cargar esta función. Cierra la app del todo y vuelve a abrirla para actualizarla.')
  }
}
