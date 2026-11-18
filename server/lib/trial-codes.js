import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { getAdminClient } from './supabase-server.js'

/**
 * Código de 6 dígitos que libera 1 MÊS GRÁTIS — gerado pelo administrador.
 *
 * MUDANÇA DE REGRA (definida pelo proprietário em 2026-11-18)
 *   Antes: toda conta nova ganhava 30 dias automaticamente.
 *   Agora: NINGUÉM ganha nada no cadastro. Quem libera o mês grátis é o
 *   administrador, gerando um código para um cliente específico e passando
 *   esse código para ele (WhatsApp). O cliente digita o código na aba de
 *   contas e recebe os 30 dias na hora.
 *
 * POR QUE ISSO RESOLVE O PROBLEMA REAL
 *   O proprietário relatou contas em série (julho3@, julho4@, julho5@…) para
 *   repetir o mês grátis. Com liberação manual, criar conta nova não gera
 *   benefício nenhum — o benefício passa a depender de uma decisão humana.
 *
 * ONDE OS CÓDIGOS FICAM
 *   Em `auth.users.app_metadata.trial_codes` do PRÓPRIO cliente.
 *   - `app_metadata` só é gravável com a Service Role: o cliente não lê nem
 *     escreve, mesmo logado e com o SDK do navegador na mão.
 *   - Fica no banco (não em memória, não em localStorage), então sobrevive a
 *     deploy, restart e troca de dispositivo.
 *   - Não exige DDL: o projeto Supabase atual não tem tabela para isso e o
 *     pedido proíbe criar tabela sem autorização. A versão relacional está em
 *     docs/sql/trial-codes.sql, pronta para quando o proprietário quiser.
 *
 * SEGURANÇA DO CÓDIGO
 *   - O código em texto puro NUNCA é gravado: guardamos
 *     sha256(pepper + userId + código). Vazar o banco não entrega códigos.
 *   - O hash inclui o `userId`, então um código gerado para o cliente A não
 *     valida para o cliente B nem por acidente.
 *   - Comparação com `timingSafeEqual` (não vaza informação por tempo).
 *   - Uso único: `used_at` é gravado na primeira validação bem-sucedida.
 *   - Validade de 7 dias (TRIAL_CODE_TTL_DAYS).
 *   - No máximo 5 tentativas por janela de 15 minutos, por conta.
 */

/** Validade do código, em dias. */
export const TRIAL_CODE_TTL_DAYS = 7

/** Duração do benefício liberado pelo código. */
export const TRIAL_DAYS = 30

/** Tentativas permitidas por janela. */
export const TRIAL_CODE_MAX_ATTEMPTS = 5

/** Tamanho da janela de tentativas. */
export const TRIAL_CODE_WINDOW_MS = 15 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Segredo do hash. Vem do ambiente quando existir; o valor padrão só evita
 * quebrar a aplicação em desenvolvimento. Mesmo com o padrão, o hash continua
 * dependendo do `userId`, então não é possível pré-calcular códigos.
 */
const PEPPER = process.env.TRIAL_CODE_PEPPER || 'movieflix-trial-code-v1'

function hashCode(code, userId) {
  return createHash('sha256').update(`${PEPPER}:${userId}:${code}`).digest('hex')
}

/** Comparação em tempo constante entre dois hashes hex. */
function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/** Código de 6 dígitos, com zeros à esquerda. */
function newCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Lista de códigos do usuário (nunca inclui o hash para o frontend). */
export function codesOf(user) {
  const list = user?.app_metadata?.trial_codes
  return Array.isArray(list) ? list : []
}

/** Versão segura para o painel: sem hash. */
export function publicCodes(user) {
  return codesOf(user).map((c) => ({
    id: c.id,
    created_at: c.created_at ?? null,
    expires_at: c.expires_at ?? null,
    used_at: c.used_at ?? null,
    created_by: c.created_by ?? null,
    status: c.used_at ? 'usado' : new Date(c.expires_at).getTime() <= Date.now() ? 'expirado' : 'ativo',
  }))
}

/**
 * Gera um código novo para o cliente.
 * Devolve o código em texto puro UMA ÚNICA VEZ — depois só existe o hash.
 */
export async function generateTrialCode({ userId, email, createdBy }) {
  const admin = getAdminClient()
  if (!admin) return { ok: false, reason: 'service_role_ausente' }

  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data?.user) return { ok: false, reason: 'user_not_found' }

  const user = data.user
  const meta = { ...(user.app_metadata ?? {}) }
  const code = newCode()
  const now = new Date()
  const expires = new Date(now.getTime() + TRIAL_CODE_TTL_DAYS * DAY_MS)

  const entry = {
    id: `tc_${now.getTime()}_${randomInt(1000, 9999)}`,
    hash: hashCode(code, userId),
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    used_at: null,
    created_by: createdBy ?? null,
  }

  // Mantém no máximo 20 códigos por conta — histórico suficiente sem crescer
  // indefinidamente dentro do JSONB.
  const list = [...codesOf(user), entry].slice(-20)
  meta.trial_codes = list

  const { error: writeErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: meta,
  })
  if (writeErr) return { ok: false, reason: 'write_failed', detail: writeErr.message }

  return {
    ok: true,
    code,
    expiresAt: entry.expires_at,
    ttlDays: TRIAL_CODE_TTL_DAYS,
    email: user.email ?? email ?? null,
  }
}

/**
 * Valida o código e libera os 30 dias.
 *
 * Devolve { ok: true, endsAt } ou { ok: false, reason }.
 * Motivos: invalid | used | expired | too_many_attempts | already_active |
 *          user_not_found | service_role_ausente | write_failed
 */
export async function redeemTrialCode({ userId, code }) {
  const admin = getAdminClient()
  if (!admin) return { ok: false, reason: 'service_role_ausente' }

  const clean = String(code ?? '').replace(/\D/g, '')
  if (clean.length !== 6) return { ok: false, reason: 'invalid' }

  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data?.user) return { ok: false, reason: 'user_not_found' }

  const user = data.user
  const meta = { ...(user.app_metadata ?? {}) }
  const now = Date.now()

  /* ── limite de tentativas ─────────────────────────────────────────────── */
  const guard = meta.trial_code_guard ?? {}
  const windowStart = guard.window_start ? new Date(guard.window_start).getTime() : 0
  const inWindow = Number.isFinite(windowStart) && now - windowStart < TRIAL_CODE_WINDOW_MS
  let attempts = inWindow ? Number(guard.attempts ?? 0) : 0

  if (attempts >= TRIAL_CODE_MAX_ATTEMPTS) {
    return {
      ok: false,
      reason: 'too_many_attempts',
      retryAfterMs: Math.max(0, TRIAL_CODE_WINDOW_MS - (now - windowStart)),
    }
  }

  /* ── já tem benefício ativo? não empilha ──────────────────────────────── */
  const trial = meta.trial
  const trialEnd = trial?.granted === true && trial?.ends_at ? new Date(trial.ends_at).getTime() : 0
  const planEnd = meta.plan_expires_at ? new Date(meta.plan_expires_at).getTime() : 0
  if (trialEnd > now || planEnd > now) {
    return { ok: false, reason: 'already_active' }
  }

  /* ── procura o código entre os DESTE cliente ──────────────────────────── */
  const list = codesOf(user)
  const wanted = hashCode(clean, userId)
  const hit = list.find((c) => sameHash(c.hash, wanted))

  if (!hit) {
    attempts += 1
    meta.trial_code_guard = {
      attempts,
      window_start: inWindow ? guard.window_start : new Date(now).toISOString(),
    }
    await admin.auth.admin.updateUserById(userId, { app_metadata: meta })
    return {
      ok: false,
      reason: 'invalid',
      attemptsLeft: Math.max(0, TRIAL_CODE_MAX_ATTEMPTS - attempts),
    }
  }

  if (hit.used_at) return { ok: false, reason: 'used' }
  if (new Date(hit.expires_at).getTime() <= now) return { ok: false, reason: 'expired' }

  /* ── libera os 30 dias ────────────────────────────────────────────────── */
  const endsAt = new Date(now + TRIAL_DAYS * DAY_MS).toISOString()
  meta.trial = {
    granted: true,
    started_at: new Date(now).toISOString(),
    ends_at: endsAt,
    source: 'admin_code',
  }
  meta.trial_codes = list.map((c) => (c.id === hit.id ? { ...c, used_at: new Date(now).toISOString() } : c))
  delete meta.trial_code_guard

  const { error: writeErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: meta,
  })
  if (writeErr) return { ok: false, reason: 'write_failed', detail: writeErr.message }

  return { ok: true, endsAt, days: TRIAL_DAYS }
}
