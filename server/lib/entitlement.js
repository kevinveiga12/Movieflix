import { getAnonClient, getClientAsUser, hasDb as dbConfigured } from './supabase-server.js'
import { adminEmails } from './profile.js'
import { trialFromMetadata } from './trial-claims.js'

/**
 * Autorização de reprodução — feita SEMPRE no servidor.
 *
 * REGRA DE NEGÓCIO ATUAL (definida pelo proprietário em 2026-11-18):
 *   1. Assistir exige conta autenticada.
 *   2. O MÊS GRÁTIS NÃO É AUTOMÁTICO. Criar conta não concede nada.
 *      Quem libera 30 dias é o ADMINISTRADOR, gerando um código de 6 dígitos
 *      para o cliente (ver server/lib/trial-codes.js). O cliente digita o
 *      código na aba de contas.
 *   3. Depois do mês grátis, só com plano pago.
 *   4. Administrador é isento de tudo.
 *
 * Onde a decisão é tomada (sempre no servidor):
 *   - `app_metadata` é lido, nunca `user_metadata`. O cliente CONSEGUE escrever
 *     `user_metadata` pelo SDK do navegador; `app_metadata` só a Service Role
 *     escreve. Confiar no primeiro permitiria "assinar" sem pagar.
 *   - Contas criadas ANTES desta regra não têm marca em `app_metadata` e
 *     continuam com o mês grátis calculado por `created_at` até o fim: ninguém
 *     perde o benefício em curso.
 *   - Contas criadas DEPOIS levam a marca `{granted:false, reason:'no_trial'}`
 *     e por isso não caem no cálculo legado.
 *
 * O que NÃO muda:
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
 * REGRA DE NEGÓCIO (definida pelo proprietário em 2026-11-18):
 *   Criar conta NÃO concede mês grátis. O benefício é liberado pelo
 *   administrador por código de 6 dígitos; depois de 30 dias, só com plano.
 *   Contas antigas (sem marca) mantêm o cálculo por `created_at` até o fim.
 *
 * Onde a decisão é tomada:
 *   - A data de criação vem de `user.created_at` do Supabase Auth, que o
 *     usuário NÃO controla (não é user_metadata).
 *   - O status do plano vem de `app_metadata`, que só o servidor escreve com a
 *     Service Role. `user_metadata` é ignorado de propósito: o próprio usuário
 *     pode editá-lo pelo SDK do navegador, então confiar nele permitiria
 *     "assinar" sem pagar.
 *
 * Nada aqui apaga conta, assinatura ou pagamento — só lê e decide.
 */

/** Duração do período gratuito, em dias. */
export const FREE_TRIAL_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Fim do período gratuito de uma conta.
 * Devolve null quando não há data de criação confiável — nesse caso o acesso
 * NÃO é liberado por tempo indeterminado (ver authorizePlayback).
 */
export function trialEndsAt(user) {
  const created = user?.created_at ?? user?.createdAt
  if (!created) return null
  const t = new Date(created).getTime()
  if (!Number.isFinite(t)) return null
  return new Date(t + FREE_TRIAL_DAYS * DAY_MS)
}

/**
 * Plano pago vigente, lido de `app_metadata` (fonte confiável).
 * Devolve { code, expires_at } ou null.
 */
export function paidPlanFromAppMetadata(user) {
  const meta = user?.app_metadata ?? {}
  const code = meta.plan_code ?? meta.plan ?? null
  if (!code) return null
  const expires = meta.plan_expires_at ?? meta.subscription_expires_at ?? null
  if (!expires) return null
  const t = new Date(expires).getTime()
  if (!Number.isFinite(t) || t <= Date.now()) return null
  return { code: String(code), expires_at: new Date(t).toISOString() }
}

/**
 * Situação de acesso da conta.
 *   { allowed, reason, trialEndsAt, daysLeft, plan }
 */
/**
 * Conta desativada pelo painel administrativo.
 *
 * Lido de `app_metadata` (só o servidor escreve com a Service Role). Fica ANTES
 * de qualquer outra regra: conta desativada não assiste nem com plano pago
 * vigente — é o que o administrador espera ao clicar em "desativar".
 */
export function isDisabled(user) {
  return user?.app_metadata?.access_disabled === true
}

export function accessState(user) {
  if (isDisabled(user)) {
    return { allowed: false, reason: 'account_disabled', plan: null, trialEndsAt: null, daysLeft: null }
  }

  // Administrador é isento de período gratuito e de vencimento.
  const email = String(user?.email ?? '').toLowerCase()
  if (email && adminEmails().includes(email)) {
    return { allowed: true, reason: 'admin', plan: null, trialEndsAt: null, daysLeft: null }
  }

  const plan = paidPlanFromAppMetadata(user)
  if (plan) {
    return { allowed: true, reason: 'plan', plan, trialEndsAt: null, daysLeft: null }
  }

  /**
   * Benefício registrado pelo servidor no cadastro (e-mail + dispositivo).
   *
   * `trialFromMetadata` devolve `undefined` para contas criadas ANTES desta
   * regra. Nesse caso caímos no cálculo por `created_at` — é o que PRESERVA o
   * mês grátis de quem já está dentro dele. Ninguém perde o benefício em curso
   * por causa da mudança.
   */
  const recorded = trialFromMetadata(user)

  if (recorded && recorded.granted === false) {
    /**
     * Conta sem benefício. Dois motivos possíveis, e a diferença importa para
     * a mensagem que o cliente lê:
     *
     *   - `no_trial`   → regra atual: ninguém ganha mês grátis no cadastro. O
     *                    benefício é liberado pelo administrador por código.
     *   - `trial_used` → regra anterior: o aparelho já havia consumido.
     *
     * Em ambos os casos a conta existe, o login funciona e o cliente pode
     * contratar um plano — só não assiste ainda.
     */
    const reason = recorded.reason === 'no_trial' ? 'no_trial' : 'trial_used'
    return {
      allowed: false,
      reason,
      plan: null,
      trialEndsAt: null,
      daysLeft: 0,
    }
  }

  const ends = recorded?.endsAt ? new Date(recorded.endsAt) : trialEndsAt(user)
  if (!ends || !Number.isFinite(ends.getTime())) {
    // Sem data de criação não há como provar o período gratuito. Negar é o
    // lado seguro: liberar "para sempre" seria pior que pedir para entrar de novo.
    return { allowed: false, reason: 'trial_unknown', plan: null, trialEndsAt: null, daysLeft: null }
  }

  const msLeft = ends.getTime() - Date.now()
  if (msLeft > 0) {
    return {
      allowed: true,
      reason: 'trial',
      plan: null,
      trialEndsAt: ends.toISOString(),
      daysLeft: Math.ceil(msLeft / DAY_MS),
    }
  }

  return {
    allowed: false,
    reason: 'trial_expired',
    plan: null,
    trialEndsAt: ends.toISOString(),
    daysLeft: 0,
  }
}

export async function authorizePlayback({ token }) {
  const resolved = await resolveUser(token)
  if (resolved.error) {
    return { allowed: false, reason: 'unauthenticated', status: 401, message: resolved.error }
  }

  const state = accessState(resolved.user)
  if (!state.allowed) {
    return {
      allowed: false,
      reason: state.reason,
      status: 402,
      message:
        state.reason === 'trial_expired'
          ? 'Seu mês grátis terminou. Contrate um plano para continuar assistindo.'
          : state.reason === 'no_trial'
            ? 'Sua conta está ativa. Para assistir, escolha um plano ou peça seu mês grátis pelo WhatsApp.'
            : state.reason === 'trial_used'
              ? 'O período grátis deste aparelho já foi utilizado. Escolha um plano para assistir.'
              : state.reason === 'account_disabled'
                ? 'Esta conta está desativada. Fale com o suporte.'
                : 'Não foi possível confirmar o período gratuito desta conta. Entre novamente.',
      access: state,
    }
  }

  return { allowed: true, user: resolved.user, subscription: null, access: state }
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
