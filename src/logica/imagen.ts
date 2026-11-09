function aJpegLigero(origen: CanvasImageSource, ancho: number, alto: number, maxLado: number, maxBytes: number) {
  const lienzo = document.createElement('canvas')
  let lado = Math.min(maxLado, Math.max(ancho, alto))
  let url = ''
  // Baja primero la calidad y después el tamaño: el resultado siempre debe caber cifrado en el relay.
  for (let intento = 0; intento < 12; intento++) {
    const escala = Math.min(1, lado / Math.max(ancho, alto))
    lienzo.width = Math.round(ancho * escala)
    lienzo.height = Math.round(alto * escala)
    lienzo.getContext('2d')!.drawImage(origen, 0, 0, lienzo.width, lienzo.height)
    for (let calidad = 0.7; calidad >= 0.45; calidad -= 0.1) {
      url = lienzo.toDataURL('image/jpeg', calidad)
      if (url.length <= maxBytes) return url
    }
    lado *= 0.8
  }
  return url
}

/** Reduce una foto de ticket a JPEG ligero (< ~90 KB) para que quepa cifrada en el relay. */
export async function comprimirFoto(archivo: File, maxLado = 900, maxBytes = 90_000): Promise<string> {
  const bmp = await createImageBitmap(archivo)
  const url = aJpegLigero(bmp, bmp.width, bmp.height, maxLado, maxBytes)
  bmp.close()
  return url
}

/** Vuelve a comprimir una foto ya guardada que no cabe en el relay. */
export async function reducirFoto(dataUrl: string, maxBytes: number): Promise<string> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  return aJpegLigero(img, img.naturalWidth, img.naturalHeight, Math.max(img.naturalWidth, img.naturalHeight), maxBytes)
}
