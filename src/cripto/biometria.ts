// Desbloqueo con Face ID / huella mediante WebAuthn + extensión PRF.
// El autenticador del móvil devuelve un secreto que solo sale tras verificar la biometría;
// con él se cifra una copia de la clave del hogar. Sin PRF no se activa (no hay atajos inseguros).
import { leerConfig, escribirConfig, db } from '../db'
import { aBase64, deBase64, aleatorio, cifrarBytes, descifrarBytes } from './index'

const SAL_PRF = new TextEncoder().encode('piso-compartido-bio-v1')

type ConCapacidades = { getClientCapabilities?: () => Promise<Record<string, boolean>> }

/** Solo se ofrece si hay lector biométrico y el navegador no declara que le falte PRF (sin PRF no hay desbloqueo seguro). */
export async function biometriaDisponible() {
  if (!window.PublicKeyCredential) return false
  if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false))) return false
  const caps = await (PublicKeyCredential as unknown as ConCapacidades).getClientCapabilities?.().catch(() => undefined)
  return caps?.['extension:prf'] !== false
}

/** Traduce los errores de WebAuthn a algo comprensible (en Android cambian mucho según el móvil). */
function explicar(e: unknown): Error {
  const err = e as Error
  if (err?.message?.includes('desbloqueo biométrico seguro')) return err
  switch (err?.name) {
    case 'NotAllowedError': return new Error('Cancelado o sin respuesta. Si usas Android, comprueba que el Gestor de contraseñas de Google está activo y tienes huella o bloqueo de pantalla configurados.')
    case 'InvalidStateError': return new Error('Este móvil ya tiene una llave para la app. Desactiva y vuelve a activar Face ID / huella.')
    case 'NotSupportedError': return new Error('Este móvil no permite desbloqueo biométrico seguro')
    case 'SecurityError': return new Error('El navegador no permite la huella en esta dirección.')
    default: return new Error(`No se pudo usar la huella (${err?.name ?? 'Error'}: ${err?.message ?? e})`)
  }
}

export const biometriaActiva = async () => !!(await leerConfig('bioCredId'))

async function claveDesdePrf(salida: ArrayBuffer) {
  return crypto.subtle.importKey('raw', salida, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

type ConPrf = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } }

async function obtenerPrf(credId: Uint8Array) {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: aleatorio(32) as BufferSource,
      allowCredentials: [{ type: 'public-key', id: credId as BufferSource }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: SAL_PRF } } } as AuthenticationExtensionsClientInputs,
    },
  }).catch((e) => { throw explicar(e) })) as PublicKeyCredential | null
  const prf = (cred?.getClientExtensionResults() as ConPrf | undefined)?.prf?.results?.first
  if (!prf) throw new Error('Este móvil no permite desbloqueo biométrico seguro')
  return prf
}

export async function activarBiometria(rawClaveHogar: Uint8Array, alias: string) {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: aleatorio(32) as BufferSource,
      rp: { name: 'PisoCompartido', id: location.hostname },
      user: { id: aleatorio(16) as BufferSource, name: alias, displayName: alias },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      // Llave de acceso completa (residente): en Android solo las guardadas en el Gestor de contraseñas de Google admiten PRF.
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required', requireResidentKey: true },
      hints: ['client-device'],
      extensions: { prf: { eval: { first: SAL_PRF } } } as AuthenticationExtensionsClientInputs,
    } as PublicKeyCredentialCreationOptions,
  }).catch((e) => { throw explicar(e) })) as PublicKeyCredential | null
  if (!cred) throw new Error('Cancelado')
  const credId = new Uint8Array(cred.rawId)
  const ext = cred.getClientExtensionResults() as ConPrf
  if (ext.prf?.enabled === false) throw new Error('Este móvil no permite desbloqueo biométrico seguro')
  const prf = ext.prf?.results?.first ?? (await obtenerPrf(credId))
  await escribirConfig('claveHogarBio', await cifrarBytes(await claveDesdePrf(prf), rawClaveHogar))
  await escribirConfig('bioCredId', aBase64(credId))
}

export async function desbloquearConBiometria() {
  const id = await leerConfig('bioCredId')
  if (!id) throw new Error('Biometría no activada')
  const prf = await obtenerPrf(deBase64(id))
  return descifrarBytes(await claveDesdePrf(prf), (await leerConfig('claveHogarBio'))!)
}

export async function desactivarBiometria() {
  await db.config.bulkDelete(['bioCredId', 'claveHogarBio'])
}
