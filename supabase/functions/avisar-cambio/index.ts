// Avisa por push al otro dispositivo del hogar. El mensaje es genérico a propósito:
// los datos están cifrados y ni Supabase ni el servicio push del móvil deben conocerlos.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const responder = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } })

webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const { hogar, dispositivo } = await req.json().catch(() => ({}))
  if (typeof hogar !== 'string' || typeof dispositivo !== 'string') return responder(400, { error: 'PETICION' })

  const { data: emisor } = await sb.from('dispositivos').select('dispositivo_id').eq('hogar_id', hogar).eq('dispositivo_id', dispositivo).maybeSingle()
  if (!emisor) return responder(403, { error: 'NO_AUTORIZADO' })

  const { data: destinos, error } = await sb.from('suscripciones_push').select('*').eq('hogar_id', hogar).neq('dispositivo_id', dispositivo)
  if (error) return responder(500, { error: 'BD' })

  let enviados = 0
  for (const d of destinos ?? []) {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify({ tipo: 'actividades' }), { TTL: 86400, urgency: 'high' })
      enviados++
    } catch (e) {
      const codigo = (e as { statusCode?: number }).statusCode
      // La suscripción ya no existe: el móvil creará otra al volver a abrir la app.
      if (codigo === 404 || codigo === 410) await sb.from('suscripciones_push').delete().eq('hogar_id', hogar).eq('dispositivo_id', d.dispositivo_id)
      else return responder(502, { error: 'PUSH' })
    }
  }
  return responder(200, { enviados })
})
