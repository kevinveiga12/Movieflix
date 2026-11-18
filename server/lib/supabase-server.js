import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

/**
 * Cliente Supabase do SERVIDOR (um só, reaproveitado).
 *
 * Duas razões para este módulo existir:
 *
 * 1. `@supabase/supabase-js` instancia o Realtime no construtor e, no Node 20,
 *    exige um WebSocket explícito — sem isto o processo MORRE com
 *    "Node.js 20 detected without native WebSocket support". O Node 22+ tem
 *    WebSocket nativo, mas o runtime do deploy não é garantido, então passamos
 *    `ws` sempre.
 * 2. Criar um cliente por requisição vazava conexões e listeners no servidor.
 *    Aqui é um singleton por credencial.
 */

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const hasDb = Boolean(url && anonKey)
export const hasServiceRole = Boolean(url && serviceKey)

const baseOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { transport: ws },
}

let anonSingleton = null
let adminSingleton = null

/** Cliente público — respeita RLS. */
export function getAnonClient() {
  if (!hasDb) return null
  if (!anonSingleton) {
    anonSingleton = createClient(url, anonKey, baseOptions)
  }
  return anonSingleton
}

/** Cliente com a Service Role — ignora RLS. NUNCA sai do servidor. */
export function getAdminClient() {
  if (!hasServiceRole) return null
  if (!adminSingleton) {
    adminSingleton = createClient(url, serviceKey, baseOptions)
  }
  return adminSingleton
}

/** Cliente que age como o usuário (Bearer do próprio usuário). */
export function getClientAsUser(accessToken) {
  if (!hasDb || !accessToken) return null
  return createClient(url, anonKey, {
    ...baseOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

export { url as supabaseUrl }
