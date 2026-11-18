import { getAnonClient, getClientAsUser, hasDb as dbConfigured } from './supabase-server.js'

/**
 * Autorização de reprodução — feita SEMPRE no servidor.
 *
 * REGRA DE NEGÓCIO ATUAL (definida pelo proprietário em 2026-11-18):
 *   O MovieFlix 2.0 é GRATUITO. Não há planos, assinaturas nem pagamentos.
 *   A única condição para assistir é ter conta e estar autenticado.
 *
 * O que mudou e por quê:
 *   A versão anterior exigia uma linha em `subscriptions` com status ativo e
 *   `expires_at` no futuro. Como o projeto Supabase atual
 *   (zhsfqptngzgbcgiwwjug) NÃO tem a tabela `subscriptions`, TODA reprodução
 *   era negada com `no_subscription` — o site parecia quebrado. O gate de
 *   assinatura foi removido; a autenticação continua obrigatória e verificada
 *   no servidor com o token do Supabase Auth.
 *
 * O que NÃO mudou:
 *   - O token é validado no servidor (auth.getUser), nunca no cliente.
 *   - A URL do vídeo só é devolvida depois da validação.
 *   - Esconder o botão no navegador não contorna nada.
 */

export const hasDb = dbConfigured

/** Cliente público (respeita RLS) — usado para validar tokens. */
function publicClient() {
  return getAnonClient()
}

/** Extrai o Bearer token do header Authorization. */
export function bearer(req) {
  const header = req.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

/**
 * Valida o token e devolve { user } ou { error, status }.
 * Usa o endpoint /auth/v1/user, que sempre confere a assinatura do JWT.
 */
export async function resolveUser(token) {
  const client = publicClient()
  if (!client) {
    return { error: 'Supabase não configurado no servidor.', status: 503 }
  }
  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user) {
    return { error: 'Sessão inválida ou expirada. Entre novamente.', status: 401 }
  }
  return { user: data.user }
}

/**
 * Decide se o usuário pode reproduzir um título.
 *
 * Plataforma gratuita: basta estar autenticado. A função continua existindo
 * (e devolvendo o mesmo formato) para que o dia em que houver planos seja só
 * reativar a checagem aqui, sem tocar no resto do código.
 */
export async function authorizePlayback({ token }) {
  const resolved = await resolveUser(token)
  if (resolved.error) {
    return { allowed: false, reason: 'unauthenticated', status: 401, message: resolved.error }
  }
  return { allowed: true, user: resolved.user, subscription: null }
}

/**
 * Planos — vazio por design.
 *
 * A tabela `plans` não existe no projeto atual e a plataforma é gratuita.
 * Devolvemos lista vazia em vez de inventar preços: a UI mostra o aviso de
 * acesso gratuito quando não há planos.
 */
export async function loadPlans() {
  const client = publicClient()
  if (!client) return []
  const { data, error } = await client
    .from('plans')
    .select('id, name, code, description, price_cents, features, duration_days, is_active')
    .eq('is_active', true)
    .order('price_cents', { ascending: true })
  if (error) return []
  return data ?? []
}

/** Compatibilidade: assinatura vigente (sempre null na plataforma gratuita). */
export async function loadSubscription() {
  return { subscription: null }
}

export function subscriptionActive() {
  return false
}

export function planLabel() {
  return 'Acesso gratuito'
}

export function planRank() {
  return 0
}

export { getClientAsUser }
