import { readAdminConfig } from './store.js'

/**
 * Preços dos planos — FONTE ÚNICA.
 *
 * Este módulo existe porque agora há DOIS consumidores do preço:
 *   1. `GET /api/plans` (a tela de planos do site, do app e da TV);
 *   2. `POST /api/payments/pix` (a cobrança no Mercado Pago).
 *
 * Se cada um calculasse o próprio valor, o cliente veria R$ 47,76 na tela e
 * receberia uma cobrança de outro valor. Aqui o cálculo é um só, e a cobrança
 * usa exatamente o número que a tela mostrou.
 *
 * A regra de preço NÃO mudou: mensal do banco (ou o padrão do proprietário),
 * 3 meses com 20% e 1 ano com 50%, com o painel podendo sobrescrever.
 */

export const PERIODS = [
  { code: '1m', months: 1, label: '1 mês', discount: 0 },
  { code: '3m', months: 3, label: '3 meses', discount: 0.2 },
  { code: '12m', months: 12, label: '1 ano', discount: 0.5 },
]

/** Dias de assinatura por período — o mesmo mapa que o painel usa. */
export const PLAN_DAYS = { '1m': 30, '3m': 90, '12m': 365 }

export const DEFAULT_PLANS = [
  {
    id: 'basico',
    code: 'basico',
    name: 'Básico',
    description: 'Para começar a assistir com qualidade.',
    price_cents: 1990,
    duration_days: 30,
    is_active: true,
    features: ['Catálogo completo de filmes e séries', 'Qualidade HD', '1 tela por vez'],
  },
  {
    id: 'standard',
    code: 'standard',
    name: 'Médio',
    description: 'O equilíbrio entre preço e qualidade.',
    price_cents: 2990,
    duration_days: 30,
    is_active: true,
    features: ['Catálogo completo de filmes e séries', 'Qualidade Full HD', '2 telas ao mesmo tempo'],
  },
  {
    id: 'premium',
    code: 'premium',
    name: 'Premium',
    description: 'A experiência completa, sem limites.',
    price_cents: 3990,
    duration_days: 30,
    is_active: true,
    features: [
      'Catálogo completo de filmes e séries',
      'Qualidade 4K quando disponível',
      '4 telas ao mesmo tempo',
      'Suporte prioritário',
    ],
  },
]

export function brl(cents) {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

export function discountFor(plan, period) {
  if (period.months === 3 && Number.isFinite(plan.discount_3m)) return plan.discount_3m
  if (period.months === 12 && Number.isFinite(plan.discount_12m)) return plan.discount_12m
  return period.discount
}

function envPrice(code, suffix) {
  const key = `PLAN_${String(code ?? '').toUpperCase()}_${suffix}_CENTS`
  const raw = process.env[key]
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function priceFor(plan, period) {
  const explicit =
    period.months === 3
      ? (plan.price_3m_cents ?? envPrice(plan.code, '3M'))
      : period.months === 12
        ? (plan.price_12m_cents ?? envPrice(plan.code, '12M'))
        : plan.price_cents

  const full = plan.price_cents * period.months

  if (Number.isFinite(explicit) && explicit > 0) {
    return { cents: explicit, full, source: period.months === 1 ? 'monthly' : 'configured' }
  }

  const cents = Math.round(full * (1 - discountFor(plan, period)))
  return { cents, full, source: 'discount' }
}

export function applyAdminConfig(plans, config) {
  const overrides = config?.plans ?? {}
  const out = []
  for (const p of plans) {
    const o = overrides[p.code] ?? overrides[p.id] ?? null
    const merged = o ? { ...p, ...o } : { ...p }
    if (merged.is_active === false) continue
    out.push(merged)
  }
  return out
}

/** Lista de planos já com a configuração do painel aplicada. */
export async function resolvePlans() {
  /**
   * Import dinâmico de propósito.
   *
   * `entitlement.js` puxa `supabase-server.js`, que exige `@supabase/supabase-js`.
   * Com import estático, este módulo não carrega sem `node_modules` — e o teste
   * de preços roda no CI antes do `npm ci`. Aqui o preço é lógica pura; só a
   * leitura do banco precisa do SDK, e ela acontece quando há banco.
   */
  let fromDb = []
  try {
    const { loadPlans } = await import('./entitlement.js')
    fromDb = (await loadPlans()) ?? []
  } catch {
    // Sem SDK/banco (ex.: teste de preço no CI antes do npm ci): usa o padrão.
    fromDb = []
  }
  const config = await readAdminConfig()
  const base = fromDb.length > 0 ? fromDb : DEFAULT_PLANS
  return applyAdminConfig(base, config)
}

/**
 * Resolve UM plano e UM período, com o valor que deve ser cobrado.
 *
 * Devolve `null` quando o plano não existe ou está desativado — a rota de
 * cobrança recusa em vez de inventar preço.
 */
export async function resolvePlanPrice(planCode, periodCode) {
  const plans = await resolvePlans()
  const plan = plans.find((p) => p.code === planCode || p.id === planCode)
  if (!plan) return null

  const period = PERIODS.find((p) => p.code === periodCode) ?? PERIODS[0]
  const { cents, full, source } = priceFor(plan, period)

  return {
    plan,
    period,
    cents,
    full,
    source,
    days: PLAN_DAYS[period.code] ?? 30,
    label: brl(cents),
  }
}
