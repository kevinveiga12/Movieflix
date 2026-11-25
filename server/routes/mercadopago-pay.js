import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import crypto from 'node:crypto'
import { bearer, resolveUser } from '../lib/entitlement.js'
import { requireAdmin } from '../lib/auth.js'
import { createPixPayment, mpConfigured, mpMode, validateAccessToken } from '../lib/mercadopago.js'
import { resolvePlanPrice, brl } from '../lib/plan-pricing.js'
import { OWNER_CPF } from '../lib/cpf.js'
import { getPaymentRecord, listPayments, paymentsForUser, paymentStats, upsertPayment } from '../lib/payments-store.js'
import { activateFromPayment } from '../lib/subscription-activation.js'

/**
 * Cobrança Pix via Mercado Pago.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA ROTA FAZ E O QUE ELA NÃO FAZ
 * ═══════════════════════════════════════════════════════════════════════════
 * FAZ: cria a cobrança no Mercado Pago com o valor que o servidor calculou e
 * devolve o QR Code e o código copia e cola.
 *
 * NÃO FAZ: liberar acesso. Nenhuma rota daqui ativa assinatura. Quem ativa é
 * `subscription-activation.js`, e só depois de consultar a API oficial e ver
 * `status: approved`. Abrir a tela de pagamento, voltar para ela ou clicar em
 * "já paguei" não libera nada — é o que o pedido exige.
 *
 * O preço NUNCA vem do cliente: o corpo só traz `plan_code` e `period`, e o
 * valor é resolvido em `plan-pricing.js` — a mesma função que a tela de planos
 * usa. Assim não há como pedir Premium pagando Básico.
 */

const router = Router()

/** Criar cobrança é caro (chama a API do provedor): limite próprio. */
const createLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de pagamento. Aguarde alguns minutos.' },
})

/** Consulta de status é barata e a tela faz polling: limite mais folgado. */
const statusLimiter = rateLimit({
  windowMs: 60_000,
  limit: 90,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas consultas. Aguarde alguns segundos.' },
})

/** Autentica e devolve o usuário, ou responde 401. */
async function requireUser(req, res) {
  const token = bearer(req)
  if (!token) {
    res.status(401).json({ error: 'Entre na sua conta para contratar um plano.' })
    return null
  }
  const resolved = await resolveUser(token)
  if (resolved.error) {
    res.status(401).json({ error: resolved.error })
    return null
  }
  return resolved.user
}

/**
 * POST /api/payments/pix
 * body: { plan_code: 'basico'|'standard'|'premium', period: '1m'|'3m'|'12m' }
 *
 * Devolve:
 *   { payment_id, status, amount_cents, amount_label, plan, period,
 *     qr_code, qr_code_base64, expires_at }
 *
 * `qr_code` é o copia e cola (texto EMV do Pix); `qr_code_base64` é a imagem
 * PNG em base64, pronta para `<img src="data:image/png;base64,...">`.
 */
router.post('/pix', createLimiter, async (req, res, next) => {
  try {
    const user = await requireUser(req, res)
    if (!user) return

    if (!mpConfigured()) {
      return res.status(503).json({
        error:
          'Pagamento por Pix indisponível no momento. Fale com o suporte pelo WhatsApp.',
        code: 'mp_unconfigured',
      })
    }

    /**
     * CPF do titular — FIXO, do dono da conta.
     *
     * O cliente NÃO digita CPF: o Mercado Pago exige `payer.identification`
     * para emitir o Pix, e a cobrança sai sempre no CPF do titular da conta
     * MovieFlix (`OWNER_CPF`). Qualquer `cpf` que venha no corpo da requisição
     * é IGNORADO — site, app e TV são clientes não confiáveis e não podem
     * escolher o CPF da cobrança.
     *
     * O CPF não é gravado em lugar nenhum: só os 4 últimos dígitos vão para o
     * registro (para o cliente reconhecer a cobrança no histórico). O número
     * completo existe apenas em memória até a chamada ao provedor.
     */
    const cpf = OWNER_CPF
    const cpfLast4 = cpf.slice(-4)

    const planCode = String(req.body?.plan_code ?? '').trim().toLowerCase()
    const periodCode = String(req.body?.period ?? '1m').trim().toLowerCase()

    const resolved = await resolvePlanPrice(planCode, periodCode)
    if (!resolved) {
      return res.status(400).json({ error: 'Plano não encontrado ou indisponível.' })
    }

    const { plan, period, cents, days } = resolved

    /**
     * Reaproveita uma cobrança pendente recente.
     *
     * Sem isto, o cliente que toca duas vezes no botão (ou volta para a tela)
     * geraria dois Pix e poderia pagar os dois. Se existe um Pix do MESMO
     * plano/período criado há menos de 10 minutos e ainda não pago, devolvemos
     * ele em vez de criar outro.
     */
    const mine = await paymentsForUser(user.id)
    const recent = mine.find(
      (p) =>
        !p.applied_at &&
        String(p.status) === 'pending' &&
        p.plan_code === plan.code &&
        p.period_code === period.code &&
        Date.now() - new Date(p.created_at ?? 0).getTime() < 10 * 60_000,
    )
    if (recent?.qr_code) {
      return res.json({
        payment_id: recent.payment_id,
        status: recent.status,
        amount_cents: recent.amount_cents,
        amount_label: brl(recent.amount_cents),
        plan: { code: plan.code, name: plan.name },
        period: { code: period.code, label: period.label, days },
        qr_code: recent.qr_code,
        qr_code_base64: recent.qr_code_base64 ?? null,
        expires_at: recent.expires_at ?? null,
        reused: true,
      })
    }

    const externalReference = `${user.id}:${plan.code}:${period.code}:${Date.now()}`

    let mp
    try {
      mp = await createPixPayment({
        amountCents: cents,
        description: `MovieFlix — ${plan.name} (${period.label})`,
        email: user.email ?? 'cliente@movieflix.app',
        identification: { type: 'CPF', number: cpf },
        externalReference,
        expiresInMinutes: 30,
        idempotencyKey: crypto.randomUUID(),
      })
    } catch (e) {
      // Erro do provedor: o cliente recebe uma frase curta, o log guarda o
      // detalhe técnico. Nunca repassamos a mensagem crua do Mercado Pago.
      console.error('[MovieFlix] mercadopago create:', e?.status, e?.message)
      return res.status(502).json({
        error: 'Não foi possível gerar o Pix agora. Tente novamente em instantes.',
        code: 'mp_create_failed',
      })
    }

    const tx = mp?.point_of_interaction?.transaction_data ?? {}
    const qrCode = tx.qr_code ?? null
    const qrBase64 = tx.qr_code_base64 ?? null

    if (!qrCode) {
      console.error('[MovieFlix] mercadopago sem qr_code:', JSON.stringify(mp).slice(0, 400))
      return res.status(502).json({
        error: 'O Pix foi criado mas o código não veio. Tente novamente.',
        code: 'mp_no_qr',
      })
    }

    await upsertPayment(String(mp.id), {
      user_id: user.id,
      user_email: user.email ?? null,
      plan_code: plan.code,
      plan_name: plan.name,
      period_code: period.code,
      period_label: period.label,
      days,
      amount_cents: cents,
      currency: 'BRL',
      status: String(mp.status ?? 'pending'),
      status_detail: mp.status_detail ?? null,
      external_reference: externalReference,
      // Só os 4 últimos dígitos: o cliente reconhece a cobrança no histórico
      // sem que o CPF completo fique gravado em disco.
      cpf_last4: cpfLast4,
      qr_code: qrCode,
      qr_code_base64: qrBase64,
      expires_at: mp.date_of_expiration ?? null,
      source: 'pix',
    })

    res.json({
      payment_id: String(mp.id),
      status: String(mp.status ?? 'pending'),
      amount_cents: cents,
      amount_label: brl(cents),
      plan: { code: plan.code, name: plan.name },
      period: { code: period.code, label: period.label, days },
      qr_code: qrCode,
      qr_code_base64: qrBase64,
      expires_at: mp.date_of_expiration ?? null,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/payments/:id/status
 *
 * Status do pagamento para a tela acompanhar em tempo real.
 *
 * Esta rota também RECONCILIA: se o webhook não chegou (deploy no meio,
 * firewall, timeout), a consulta do cliente é o que salva o pagamento. Ela
 * chama `activateFromPayment`, que consulta a API oficial e ativa se estiver
 * aprovado — idempotente, então chamar de novo não estende nada.
 *
 * Só o dono do pagamento (ou um admin) pode consultar.
 */
router.get('/:id/status', statusLimiter, async (req, res, next) => {
  try {
    const user = await requireUser(req, res)
    if (!user) return

    const id = String(req.params.id ?? '')
    const record = await getPaymentRecord(id)
    if (!record) return res.status(404).json({ error: 'Pagamento não encontrado.' })

    if (record.user_id !== user.id) {
      return res.status(403).json({ error: 'Este pagamento não é da sua conta.' })
    }

    // Reconcilia só enquanto não aplicado — depois disso o estado é final.
    let activation = null
    if (!record.applied_at) {
      activation = await activateFromPayment(id)
    }

    const fresh = (await getPaymentRecord(id)) ?? record

    res.json({
      payment_id: fresh.payment_id,
      status: fresh.status,
      status_detail: fresh.status_detail ?? null,
      amount_cents: fresh.amount_cents,
      amount_label: brl(fresh.amount_cents),
      plan: { code: fresh.plan_code, name: fresh.plan_name ?? fresh.plan_code },
      period: { code: fresh.period_code, label: fresh.period_label ?? fresh.period_code },
      qr_code: fresh.qr_code ?? null,
      qr_code_base64: fresh.qr_code_base64 ?? null,
      expires_at: fresh.expires_at ?? null,
      approved: String(fresh.status) === 'approved',
      activated: Boolean(fresh.applied_at),
      plan_expires_at: fresh.plan_expires_at ?? null,
      activation,
    })
  } catch (e) {
    next(e)
  }
})

/** GET /api/payments/mine — histórico de compras da conta logada. */
router.get('/mine', async (req, res, next) => {
  try {
    const user = await requireUser(req, res)
    if (!user) return
    const rows = await paymentsForUser(user.id)
    res.json({
      payments: rows.map((p) => ({
        payment_id: p.payment_id,
        status: p.status,
        amount_cents: p.amount_cents,
        amount_label: brl(p.amount_cents),
        plan_code: p.plan_code,
        plan_name: p.plan_name ?? p.plan_code,
        period_code: p.period_code,
        created_at: p.created_at,
        approved_at: p.approved_at ?? null,
        applied_at: p.applied_at ?? null,
        plan_expires_at: p.plan_expires_at ?? null,
      })),
    })
  } catch (e) {
    next(e)
  }
})

/** GET /api/payments/config — o app descobre se o Pix está disponível. */
router.get('/config', (_req, res) => {
  res.json({
    pix_enabled: mpConfigured(),
    mode: mpMode(),
    // O token NUNCA sai daqui. Só o modo, para o painel avisar se está em teste.
  })
})

export { router as paymentsRouter }

/* ───────────────────────────────────────────────────────────────────────────
 * PAINEL ADMINISTRATIVO — pagamentos
 *
 * Montado em /api/admin/payments, com `requireAdmin` (verifica is_admin no
 * banco com a Service Role). Mostra cliente, e-mail, plano, valor, data,
 * identificador, status, ativação e vencimento — o que o pedido lista.
 * ─────────────────────────────────────────────────────────────────────────── */

const adminRouter = Router()
adminRouter.use(requireAdmin)

adminRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 200) || 200, 1000)
    const rows = await listPayments({ limit })
    const status = req.query.status ? String(req.query.status) : null
    const filtered = status ? rows.filter((p) => String(p.status) === status) : rows

    res.json({
      payments: filtered.map((p) => ({
        payment_id: p.payment_id,
        user_id: p.user_id,
        user_email: p.user_email ?? null,
        plan_code: p.plan_code,
        plan_name: p.plan_name ?? p.plan_code,
        period_code: p.period_code,
        amount_cents: p.amount_cents,
        amount_label: brl(p.amount_cents),
        status: p.status,
        status_detail: p.status_detail ?? null,
        created_at: p.created_at,
        approved_at: p.approved_at ?? null,
        applied_at: p.applied_at ?? null,
        plan_expires_at: p.plan_expires_at ?? null,
      })),
      stats: await paymentStats(),
      mode: mpMode(),
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/admin/payments/health — auditoria das credenciais do Mercado Pago.
 *
 * Faz uma chamada SOMENTE DE LEITURA (`GET /users/me`) para provar que o token
 * é aceito, e informa se o segredo do webhook está carregado. Nunca devolve o
 * token nem o segredo — só booleanos e metadados públicos da conta.
 */
adminRouter.get('/health', async (_req, res, next) => {
  try {
    const token = await validateAccessToken()
    res.json({
      access_token: {
        present: mpConfigured(),
        valid: token.ok,
        reason: token.reason,
        mode: token.mode,
        site_id: token.siteId ?? null,
        country_id: token.countryId ?? null,
        is_test_user: token.isTestUser ?? null,
      },
      webhook_secret: {
        present: Boolean(process.env.MP_WEBHOOK_SECRET),
      },
      webhook_url: 'https://movieflix.velixir.run/api/mercadopago/webhook',
      pix_enabled: mpConfigured(),
      mode: mpMode(),
    })
  } catch (e) {
    next(e)
  }
})

/** POST /api/admin/payments/:id/reconcile — força a conferência de um Pix. */
adminRouter.post('/:id/reconcile', async (req, res, next) => {
  try {
    const result = await activateFromPayment(String(req.params.id))
    res.json({ ok: true, ...result })
  } catch (e) {
    next(e)
  }
})

export { adminRouter as paymentsAdminRouter }
