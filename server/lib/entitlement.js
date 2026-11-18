import { createClient } from '@supabase/supabase-js'

/**
 * Autorização de reprodução — feita SEMPRE no servidor.
 *
 * Regra de negócio (verificada no banco em 2026-11-18):
 *   profiles(id, email, name, avatar_url, is_admin, created_at)
 *     -> ATENÇÃO: a coluna de nome é `name`, NÃO `full_name`. Consultar
 *        `full_name` devolve 42703 e derruba o carregamento do perfil.
 *   subscriptions(user_id, plan_id, plan_code, status, expires_at,
 *                 payment_id, created_at, updated_at)
 *   plans(id, name, code, description, price_cents, features,
 *         duration_days, is_active)
 *
 * Um usuário só assiste se, ao mesmo tempo:
 *   1. o token do Supabase Auth for válido (getUser);
 *   2. existir assinatura com status ativo;
 *   3. `expires_at` estiver no futuro;
 *   4. o plano dela cobrir o `required_plan` do título.
 *
 * Hierarquia: simple (1) < standard (2) < premium (3).
 */

import { getAnonClient, getClientAsUser, hasDb as dbConfigured } from './supabase-server.js'

export const hasDb = dbConfigured

/** Cliente público (respeita RLS) — usado para catálogo e para validar tokens. */
function publicClient() {
  return getAnonClient()
}

const PLAN_RANK = { simple: 1, standard: 2, premium: 3 }
const PLAN_LABEL = { simple: 'Plano 1', standard: 'Plano 2', premium: 'Plano 3' }

export function planRank(code) {
  return PLAN_RANK[String(code ?? '').toLowerCase()] ?? 0
}

export function planLabel(code) {
  return PLAN_LABEL[String(code ?? '').toLowerCase()] ?? 'Plano'
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
 * Lê a assinatura vigente do usuário.
 * A tabela `subscriptions` é a MESMA que o app de TV e o site leem, então a
 * ativação é compartilhada entre dispositivos por construção.
 */
export async function loadSubscription(token, userId) {
  const client = publicClient()
  if (!client) return { subscription: null }

  const asUser = getClientAsUser(token)
  if (!asUser) return { subscription: null }

  const { data, error } = await asUser
    .from('subscriptions')
    .select('id, user_id, plan_id, plan_code, status, expires_at, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    // 42501/PGRST116 = sem permissão/nenhuma linha — não é erro fatal.
    return { subscription: null, note: error.message }
  }
  return { subscription: data ?? null }
}

/** Lê os planos ativos (público — não expõe nada sensível). */
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

/** Assinatura está vigente? */
export function subscriptionActive(sub) {
  if (!sub) return false
  const status = String(sub.status ?? '').toLowerCase()
  if (status !== 'active') return false
  if (!sub.expires_at) return false
  const expires = new Date(sub.expires_at).getTime()
  return Number.isFinite(expires) && expires > Date.now()
}

/**
 * Decide se o usuário pode reproduzir um título.
 * Devolve um objeto com `allowed` e, quando negado, o `reason` que a UI usa.
 */
export async function authorizePlayback({ token, requiredPlan }) {
  const resolved = await resolveUser(token)
  if (resolved.error) {
    return { allowed: false, reason: 'unauthenticated', status: 401, message: resolved.error }
  }

  const { subscription } = await loadSubscription(token, resolved.user.id)
  const active = subscriptionActive(subscription)

  if (!active) {
    return {
      allowed: false,
      reason: 'no_subscription',
      status: 402,
      message: 'É preciso um plano ativo para assistir. Escolha um plano para liberar a reprodução.',
      user: resolved.user,
      subscription,
    }
  }

  const userRank = planRank(subscription?.plan_code)
  const neededRank = planRank(requiredPlan)

  if (neededRank > userRank) {
    return {
      allowed: false,
      reason: 'plan_too_low',
      status: 403,
      message: `Este título exige o ${planLabel(requiredPlan)}. Seu plano atual é o ${planLabel(subscription?.plan_code)}.`,
      user: resolved.user,
      subscription,
      requiredPlan,
    }
  }

  return { allowed: true, user: resolved.user, subscription }
}
