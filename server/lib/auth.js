import { createClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase do servidor.
 *
 * Usa a SERVICE ROLE KEY quando disponível (necessário para checar is_admin de
 * qualquer usuário e para operações administrativas). A chave NUNCA sai do
 * servidor: não é enviada ao navegador nem incluída no build do frontend.
 */

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY

export const hasServiceRole = Boolean(url && serviceKey)

export const supabaseAdmin = hasServiceRole
  ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

/** Cliente com o token do usuário — respeita RLS. */
export function supabaseAsUser(accessToken) {
  if (!url || !anonKey) return null
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Valida o Bearer token e devolve o usuário + se é admin.
 * A checagem de admin é feita no BANCO (profiles.is_admin), nunca no cliente.
 */
export async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Token ausente.' })

    if (!supabaseAdmin) {
      return res.status(503).json({
        error: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY configurada — administração indisponível.',
      })
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Sessão inválida.' })

    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('id, is_admin')
      .eq('id', userData.user.id)
      .maybeSingle()

    if (profErr) return res.status(500).json({ error: 'Falha ao verificar permissões.' })
    if (!profile?.is_admin) return res.status(403).json({ error: 'Acesso restrito a administradores.' })

    req.user = userData.user
    req.isAdmin = true
    next()
  } catch (e) {
    console.error('[MovieFlix] requireAdmin:', e?.message)
    res.status(500).json({ error: 'Erro ao validar permissões.' })
  }
}
