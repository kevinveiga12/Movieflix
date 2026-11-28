/**
 * Perfis por conta e limites por plano.
 *
 * ── REGRA DE NEGÓCIO (definida pelo proprietário em 2026-11-28) ──────────────
 *   Básico   → 1 perfil normal, 0 perfis infantis
 *   Médio    → 2 perfis normais + 1 perfil infantil
 *   Premium  → 4 perfis normais + 1 perfil infantil
 *
 * O perfil INFANTIL é um tipo próprio, contado SEPARADAMENTE dos normais, e
 * limitado a 1 por conta em todos os planos que o oferecem. Ele só enxerga
 * conteúdo infantil — no catálogo, na busca e no player.
 *
 * ── ONDE FICA GRAVADO ───────────────────────────────────────────────────────
 * `auth.users.app_metadata.profiles` (array) e `app_metadata.active_profile_id`.
 * `app_metadata` só a Service Role escreve — o cliente NÃO consegue se dar
 * perfis extras nem trocar o tipo de um perfil pelo SDK do navegador. Nenhuma
 * tabela nova, nenhuma migração, nada do Supabase é alterado.
 *
 * Este módulo é PURO (sem Supabase, sem Express) para poder ser testado sem
 * banco — ver `scripts/test-profiles.mjs`.
 */

/** Limites por plano. `adult` = perfis normais; `kids` = perfis infantis. */
export const PLAN_PROFILE_LIMITS = {
  basico: { adult: 1, kids: 0 },
  standard: { adult: 2, kids: 1 },
  premium: { adult: 4, kids: 1 },
}

/** Rótulo do plano, para a mensagem que o cliente lê. */
export const PLAN_LABELS = {
  basico: 'Básico',
  standard: 'Médio',
  premium: 'Premium',
}

/**
 * Limite aplicado quando a conta não tem plano vigente.
 *
 * Sem plano o cliente não assiste nada (ver entitlement.js), mas a tela de
 * perfis continua existindo. Aplicamos o limite mais restrito — o do Básico —
 * em vez de liberar tudo: quem não paga não ganha mais perfis que o plano de
 * entrada.
 */
export const NO_PLAN_LIMITS = { adult: 1, kids: 0 }

/** Normaliza o código do plano vindo de `app_metadata`. */
export function normalizePlanCode(code) {
  const c = String(code ?? '').trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(PLAN_PROFILE_LIMITS, c) ? c : null
}

/** Limites do plano. Sem plano (ou plano desconhecido) → limites do Básico. */
export function limitsForPlan(planCode) {
  const code = normalizePlanCode(planCode)
  return code ? { ...PLAN_PROFILE_LIMITS[code] } : { ...NO_PLAN_LIMITS }
}

/** `adult` | `kids` — qualquer outra coisa cai em `adult`. */
export function normalizeKind(kind) {
  return String(kind ?? '').trim().toLowerCase() === 'kids' ? 'kids' : 'adult'
}

/** Lista de perfis gravada em `app_metadata`, sempre como array válido. */
export function readProfiles(meta) {
  const raw = meta?.profiles
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p) => p && typeof p === 'object' && p.id)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name ?? '').trim() || 'Perfil',
      kind: normalizeKind(p.kind),
      created_at: p.created_at ?? null,
    }))
}

/** Quantos perfis de cada tipo a conta já tem. */
export function countProfiles(profiles) {
  const list = Array.isArray(profiles) ? profiles : []
  return {
    adult: list.filter((p) => normalizeKind(p.kind) === 'adult').length,
    kids: list.filter((p) => normalizeKind(p.kind) === 'kids').length,
    total: list.length,
  }
}

/**
 * Pode criar mais um perfil deste tipo?
 *
 * Devolve sempre o motivo em português, pronto para o painel exibir — a mesma
 * frase é usada pelo servidor (que recusa) e pela tela (que bloqueia o botão),
 * então o cliente nunca vê duas versões da mesma regra.
 */
export function canCreateProfile(planCode, profiles, kind) {
  const k = normalizeKind(kind)
  const limits = limitsForPlan(planCode)
  const used = countProfiles(profiles)
  const limit = limits[k]
  const current = used[k]

  if (current >= limit) {
    const code = normalizePlanCode(planCode)
    const planLabel = code ? `O plano ${PLAN_LABELS[code]}` : 'Sua conta (sem plano ativo)'
    const what = k === 'kids' ? 'perfil infantil' : 'perfil'
    const plural = limit === 1 ? '' : 's'
    return {
      allowed: false,
      kind: k,
      limit,
      used: current,
      reason:
        limit === 0
          ? `${planLabel} não inclui perfil infantil.`
          : `${planLabel} permite ${limit} ${what}${plural} e você já tem ${current}.`,
    }
  }

  return { allowed: true, kind: k, limit, used: current, reason: null }
}

/**
 * Resumo para a tela: limites, uso e se cada tipo ainda pode crescer.
 */
export function profileSummary(planCode, profiles) {
  const limits = limitsForPlan(planCode)
  const used = countProfiles(profiles)
  const code = normalizePlanCode(planCode)
  return {
    plan: code,
    planLabel: code ? PLAN_LABELS[code] : null,
    limits,
    used,
    canCreateAdult: canCreateProfile(planCode, profiles, 'adult'),
    canCreateKids: canCreateProfile(planCode, profiles, 'kids'),
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * CONTEÚDO INFANTIL
 *
 * O catálogo não tem campo `adult` nem classificação indicativa (verificado:
 * `adult` é null em 18.080 filmes). O único sinal confiável é a categoria, que
 * vem do TMDB composta ("Animação, Família, Comédia").
 *
 * Regra: o título é infantil quando tem pelo menos um gênero infantil E nenhum
 * gênero adulto. Só "Animação" não basta — existe animação de terror e de
 * crime no catálogo, e um perfil infantil não pode abrir isso.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Gêneros que caracterizam conteúdo infantil. */
const KIDS_GENRES = new Set(['animação', 'animacao', 'família', 'familia', 'kids', 'infantil'])

/** Gêneros que desqualificam o título, mesmo sendo animação. */
const ADULT_GENRES = new Set([
  'terror',
  'suspense',
  'crime',
  'guerra',
  'erótico',
  'erotico',
  'adulto',
  'drogas',
  'assassinato',
  'faroeste',
  'soap',
])

/** Minúsculas e sem acento — a mesma normalização usada na busca de clientes. */
function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Termos de gênero de um título ("Animação, Família" → ['animacao','familia']). */
export function categoryTerms(category) {
  return String(category ?? '')
    .split(',')
    .map((p) => fold(p).trim())
    .filter(Boolean)
}

/**
 * O título é conteúdo infantil?
 *
 * Aceita o objeto do catálogo ou a string de categoria — as duas formas
 * aparecem no código (o catálogo estático e as rotas de API).
 */
export function isKidsContent(titleOrCategory) {
  const category =
    typeof titleOrCategory === 'string' ? titleOrCategory : titleOrCategory?.category
  const terms = categoryTerms(category)
  if (terms.length === 0) return false
  if (terms.some((t) => ADULT_GENRES.has(t))) return false
  return terms.some((t) => KIDS_GENRES.has(t))
}

/** Filtra uma lista do catálogo para o que um perfil infantil pode ver. */
export function filterKidsContent(list) {
  return (Array.isArray(list) ? list : []).filter(isKidsContent)
}
