import { Router } from 'express'
import QRCode from 'qrcode'
import { loadPlans } from '../lib/entitlement.js'
import { readAdminConfig } from '../lib/store.js'

/**
 * Planos e tabela de preços por período.
 *
 * TABELA POR PERÍODO (1 mês / 3 meses / 1 ano)
 * --------------------------------------------
 * Os preços MENSAIS vêm do banco (tabela `plans`). Quando o banco ainda não
 * tem planos cadastrados, usamos a configuração canônica definida pelo
 * proprietário — os mesmos três valores que ele informou:
 *
 *     Básico   R$ 19,90 / mês
 *     Standard R$ 29,90 / mês
 *     Premium  R$ 39,90 / mês
 *
 * DESCONTOS (definidos pelo proprietário em 2026-11-18)
 * -----------------------------------------------------
 *     1 mês   → sem desconto
 *     3 meses → 20% de desconto
 *     1 ano   → 50% de desconto
 *
 * O valor do período é calculado como `mensal × meses × (1 − desconto)`. O
 * valor cheio (`full_cents`) também é devolvido para a UI mostrar o preço
 * riscado e a economia. Nada é inventado: os descontos são os informados e a
 * base é o preço mensal já configurado.
 */

const router = Router()

const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER ?? '5511943750307'
const WHATSAPP_DISPLAY = process.env.WHATSAPP_DISPLAY ?? '(11) 94375-0307'

/**
 * Períodos oferecidos. `discount` é a fração abatida do valor cheio.
 *
 * O desconto padrão é o definido pelo proprietário (0% / 20% / 50%), mas o
 * painel administrativo pode sobrescrevê-lo por plano — ver `discountFor`.
 */
const PERIODS = [
  { code: '1m', months: 1, label: '1 mês', discount: 0 },
  { code: '3m', months: 3, label: '3 meses', discount: 0.2 },
  { code: '12m', months: 12, label: '1 ano', discount: 0.5 },
]

/**
 * Desconto efetivo de um plano num período.
 *
 * Precedência: configuração do painel (`discount_3m` / `discount_12m`, em
 * fração 0..1) → padrão do período. O painel grava fração, não porcentagem,
 * para não haver ambiguidade entre 20 e 0,2.
 */
function discountFor(plan, period) {
  if (period.months === 3 && Number.isFinite(plan.discount_3m)) return plan.discount_3m
  if (period.months === 12 && Number.isFinite(plan.discount_12m)) return plan.discount_12m
  return period.discount
}

/**
 * Configuração canônica dos planos.
 *
 * Usada quando a tabela `plans` do Supabase está vazia (é o estado atual do
 * projeto). Se o administrador cadastrar os planos no banco, os valores do
 * banco têm prioridade — este bloco é só o padrão.
 */
const DEFAULT_PLANS = [
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

function brl(cents) {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

/**
 * Preço de um período.
 *
 * Ordem de precedência:
 *   1. valor explícito do banco (`price_3m_cents` / `price_12m_cents`)
 *   2. variável de ambiente (`PLAN_<CODE>_3M_CENTS` / `_12M_CENTS`)
 *   3. mensal × meses × (1 − desconto)  ← regra atual
 *
 * `source` diz de onde veio, para o painel saber o que é preço definido e o
 * que é calculado pela regra de desconto.
 */
function priceFor(plan, period) {
  const explicit =
    period.months === 3
      ? (plan.price_3m_cents ?? envPrice(plan.code, '3M'))
      : period.months === 12
        ? (plan.price_12m_cents ?? envPrice(plan.code, '12M'))
        : plan.price_cents

  const full = plan.price_cents * period.months

  if (Number.isFinite(explicit) && explicit > 0) {
    return {
      cents: explicit,
      full,
      source: period.months === 1 ? 'monthly' : 'configured',
    }
  }

  // Regra de desconto: arredonda para o centavo.
  const cents = Math.round(full * (1 - discountFor(plan, period)))
  return { cents, full, source: 'discount' }
}

function envPrice(code, suffix) {
  const key = `PLAN_${String(code ?? '').toUpperCase()}_${suffix}_CENTS`
  const raw = process.env[key]
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Mensagem do WhatsApp para um plano/período.
 *
 * Inclui e-mail, plano, duração e valor — o proprietário pediu que a conversa
 * já abra com tudo preenchido. O e-mail vem do cliente (conta logada); quando
 * não há sessão, o texto diz isso em vez de mandar um campo vazio.
 */
function whatsappMessage({ planName, periodLabel, priceLabel, email }) {
  const lines = [
    'Olá! Quero assinar o MovieFlix.',
    '',
    `Plano: ${planName}`,
    `Duração: ${periodLabel}`,
    `Valor: ${priceLabel}`,
    `E-mail da conta: ${email || 'não informado (não estou logado)'}`,
  ]
  return lines.join('\n')
}

/**
 * Aplica a configuração do painel sobre a lista de planos.
 *
 * O painel pode: mudar o preço mensal, mudar os descontos de 3m/12m e ativar ou
 * desativar um plano. Plano desativado sai da lista pública (mas continua no
 * arquivo, para poder ser reativado sem perder o preço configurado).
 */
function applyAdminConfig(plans, config) {
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

router.get('/', async (req, res, next) => {
  try {
    const [fromDb, config] = await Promise.all([loadPlans(), readAdminConfig()])
    const base = fromDb.length > 0 ? fromDb : DEFAULT_PLANS
    const plans = applyAdminConfig(base, config)

    // E-mail da conta logada, quando o cliente manda o token.
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : ''

    const shaped = plans.map((p) => {
      const periods = PERIODS.map((period) => {
        const { cents, full, source } = priceFor(p, period)
        const saved = full - cents
        return {
          code: period.code,
          label: period.label,
          months: period.months,
          discount: discountFor(p, period),
          price_cents: cents,
          price_label: brl(cents),
          full_cents: full,
          full_label: brl(full),
          saved_cents: saved,
          saved_label: brl(saved),
          price_source: source,
          whatsapp_url: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
            whatsappMessage({
              planName: p.name,
              periodLabel: period.label,
              priceLabel: brl(cents),
              email,
            }),
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
      periods: PERIODS.map((p) => ({
        code: p.code,
        label: p.label,
        months: p.months,
        discount: p.discount,
      })),
      whatsapp: { number: WHATSAPP_NUMBER, display: WHATSAPP_DISPLAY },
      source: fromDb.length > 0 ? 'database' : 'default',
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/plans/qr?plan=<code>&period=<1m|3m|12m>&email=<opcional>
 *
 * Devolve o QR Code (PNG) do link de contratação pelo WhatsApp.
 *
 * Existe para a TV: o controle remoto não digita, então o app mostra o QR na
 * tela e o cliente lê com o celular. O QR aponta para o MESMO `whatsapp_url`
 * que o site usa — a mensagem (plano, duração, valor, e-mail) é montada aqui,
 * uma vez, para o app não remontar o texto e divergir.
 *
 * Nada de preço é inventado: os valores vêm de `priceFor`, a mesma função da
 * listagem de planos.
 */
router.get('/qr', async (req, res, next) => {
  try {
    const [fromDb, config] = await Promise.all([loadPlans(), readAdminConfig()])
    const base = fromDb.length > 0 ? fromDb : DEFAULT_PLANS
    const plans = applyAdminConfig(base, config)

    const planCode = String(req.query.plan ?? '').trim()
    const periodCode = String(req.query.period ?? '1m').trim()
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : ''

    const plan = plans.find((p) => p.code === planCode || p.id === planCode)
    if (!plan) {
      res.status(404).json({ error: 'plan_not_found' })
      return
    }
    const period = PERIODS.find((p) => p.code === periodCode) ?? PERIODS[0]
    const { cents } = priceFor(plan, period)

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
      whatsappMessage({
        planName: plan.name,
        periodLabel: period.label,
        priceLabel: brl(cents),
        email,
      }),
    )}`

    const png = await QRCode.toBuffer(url, {
      type: 'png',
      width: 640,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })

    res.set('Content-Type', 'image/png')
    res.set('Cache-Control', 'public, max-age=300')
    res.send(png)
  } catch (e) {
    next(e)
  }
})

export { router as plansRouter }
