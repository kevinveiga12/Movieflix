import { Router } from 'express'
import { loadPlans } from '../lib/entitlement.js'

/**
 * Planos.
 *
 * Os preços vêm do BANCO (tabela `plans`), nunca do código — assim o
 * administrador pode ajustar sem deploy, e nenhum valor é inventado aqui.
 * Verificado em 2026-11-18:
 *   Plano 1 / simple   / R$ 19,90 / HD      / 1 tela
 *   Plano 2 / standard / R$ 29,90 / Full HD / 2 telas
 *   Plano 3 / premium  / R$ 39,90 / 4K      / 4 telas
 *
 * A contratação é feita pelo WhatsApp (mesmo número usado pelo app de TV).
 */

const router = Router()

const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER ?? '5511943750307'
const WHATSAPP_DISPLAY = process.env.WHATSAPP_DISPLAY ?? '(11) 94375-0307'

router.get('/', async (_req, res, next) => {
  try {
    const plans = await loadPlans()
    res.json({
      plans: plans.map((p) => ({
        ...p,
        price_label: `R$ ${(p.price_cents / 100).toFixed(2).replace('.', ',')}`,
        whatsapp_url: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
          `Olá! Quero assinar o MovieFlix — ${p.name} (${p.price_cents / 100 > 0 ? `R$ ${(p.price_cents / 100).toFixed(2).replace('.', ',')}` : 'grátis'}).`,
        )}`,
      })),
      whatsapp: { number: WHATSAPP_NUMBER, display: WHATSAPP_DISPLAY },
    })
  } catch (e) {
    next(e)
  }
})

export { router as plansRouter }
