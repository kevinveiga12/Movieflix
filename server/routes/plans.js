import { Router } from 'express'
import { loadPlans } from '../lib/entitlement.js'

/**
 * Planos e tabela de preços por período.
 *
 * Os preços vêm do BANCO (tabela `plans`), nunca do código — assim o
 * administrador ajusta sem deploy e nenhum valor é inventado aqui.
 *
 * TABELA POR PERÍODO (1 mês / 3 meses / 1 ano)
 * --------------------------------------------
 * O banco guarda o preço MENSAL de cada plano (`price_cents`). Os períodos de
 * 3 meses e 1 ano são derivados por multiplicação simples, SEM desconto:
 *
 *     3 meses = mensal x 3
 *     1 ano   = mensal x 12
 *
 * Isso é aritmética sobre um valor que já existe, não um preço novo inventado.
 * Quando o proprietário definir preços promocionais para 3 meses / 1 ano, basta
 * preencher `price_3m_cents` / `price_12m_cents` na tabela `plans` (ou nas
 * variáveis PLAN_*_3M_CENTS / PLAN_*_12M_CENTS) e eles passam a valer — o
 * código já lê esses campos primeiro.
 *
 * Preços mensais configurados no projeto:
 *   Básico   R$ 19,90
 *   Standard R$ 29,90
 *   Premium  R$ 39,90
 */

const router = Router()

const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER ?? '5511943750307'
const WHATSAPP_DISPLAY = process.env.WHATSAPP_DISPLAY ?? '(11) 94375-0307'

/** Períodos oferecidos. `months` é o multiplicador do preço mensal. */
const PERIODS = [
  { code: '1m', months: 1, label: '1 mês' },
  { code: '3m', months: 3, label: '3 meses' },
  { code: '12m', months: 12, label: '1 ano' },
]

function brl(cents) {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

/**
 * Preço de um período.
 * Ordem: valor explícito do banco → variável de ambiente → mensal x meses.
 * `source` diz de onde veio, para o relatório e o painel saberem o que é
 * preço definido e o que é apenas o mensal multiplicado.
 */
function priceFor(plan, period) {
  const explicit =
    period.months === 3
      ? (plan.price_3m_cents ?? envPrice(plan.code, '3M'))
      : period.months === 12
        ? (plan.price_12m_cents ?? envPrice(plan.code, '12M'))
        : plan.price_cents

  if (Number.isFinite(explicit) && explicit > 0) {
    return { cents: explicit, source: period.months === 1 ? 'monthly' : 'configured' }
  }
  return { cents: plan.price_cents * period.months, source: 'derived' }
}

function envPrice(code, suffix) {
  const key = `PLAN_${String(code ?? '').toUpperCase()}_${suffix}_CENTS`
  const raw = process.env[key]
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

router.get('/', async (_req, res, next) => {
  try {
    const plans = await loadPlans()

    const shaped = plans.map((p) => {
      const periods = PERIODS.map((period) => {
        const { cents, source } = priceFor(p, period)
        return {
          code: period.code,
          label: period.label,
          months: period.months,
          price_cents: cents,
          price_label: brl(cents),
          // 'derived' = mensal x meses (sem desconto definido ainda)
          price_source: source,
          whatsapp_url: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
            `Olá! Quero assinar o MovieFlix — ${p.name} (${period.label}) por ${brl(cents)}.`,
          )}`,
        }
      })

      return {
        ...p,
        price_label: brl(p.price_cents),
        periods,
        // Mantém o link do plano mensal para quem já usava esse campo.
        whatsapp_url: periods[0].whatsapp_url,
      }
    })

    res.json({
      plans: shaped,
      periods: PERIODS.map((p) => ({ code: p.code, label: p.label, months: p.months })),
      whatsapp: { number: WHATSAPP_NUMBER, display: WHATSAPP_DISPLAY },
    })
  } catch (e) {
    next(e)
  }
})

export { router as plansRouter }
