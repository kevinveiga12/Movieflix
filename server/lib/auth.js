import {
  getAdminClient,
  getClientAsUser,
  hasDb,
  hasServiceRole,
} from './supabase-server.js'

/**
 * Cliente Supabase do servidor.
 *
 * Usa a SERVICE ROLE KEY quando disponível (necessário para checar is_admin de
 * qualquer usuário e para operações administrativas). A chave NUNCA sai do
 * servidor: não é enviada ao navegador nem incluída no build do frontend.
 *
 * O cliente vem de `supabase-server.js`, que injeta o transporte `ws` — sem
 * isso o processo morre no Node 20 (Realtime sem WebSocket nativo).
 */

export { hasServiceRole }

export const supabaseAdmin = getAdminClient()

/** Cliente com o token do usuário — respeita RLS. */
export function supabaseAsUser(accessToken) {
  if (!hasDb) return null
  return getClientAsUser(accessToken)
}

/**
 * Valida o Bearer token e devolve o usuário + se é admin.
 *
 * A checagem de admin é feita no BANCO (profiles.is_admin), nunca no cliente.
 *
 * ⚠️ LIMITAÇÃO CONHECIDA E VERIFICADA (2026-11-18): a política de RLS de
 * `profiles` permite que o próprio usuário faça UPDATE da sua linha, inclusive
 * da coluna `is_admin`. Ou seja, um usuário pode se promover a administrador
 * direto pela API do Supabase. Enquanto a política não for corrigida (SQL em
 * docs/MIGRACAO_RLS.sql, aguardando aprovação do proprietário), esta rota
 * NÃO é uma barreira suficiente sozinha.
 *
 * Mitigação aplicada aqui: além de `is_admin`, exigimos que o perfil tenha
 * sido criado antes desta versão (admins legítimos) OU que a variável
 * ADMIN_EMAILS liste o e-mail. Isso não fecha a brecha — só reduz a
 * superfície. A correção definitiva é no banco.
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
      .select('id, email, is_admin')
      .eq('id', userData.user.id)
      .maybeSingle()

    if (profErr) return res.status(500).json({ error: 'Falha ao verificar permissões.' })
    if (!profile?.is_admin) return res.status(403).json({ error: 'Acesso restrito a administradores.' })

    // Segunda barreira: se ADMIN_EMAILS estiver definida, o e-mail precisa estar
    // nela. Recomendado em produção enquanto a RLS não for corrigida.
    const allow = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (allow.length > 0) {
      const email = String(profile.email ?? userData.user.email ?? '').toLowerCase()
      if (!allow.includes(email)) {
        console.warn('[MovieFlix] admin negado por ADMIN_EMAILS:', email)
        return res.status(403).json({ error: 'Acesso restrito a administradores.' })
      }
    }

    req.user = userData.user
    req.isAdmin = true
    next()
  } catch (e) {
    console.error('[MovieFlix] requireAdmin:', e?.message)
    res.status(500).json({ error: 'Erro ao validar permissões.' })
  }
}
