import { Router } from 'express'
import {
  mpConfigured,
  paymentIdFromNotification,
  verifyWebhookSignature,
} from '../lib/mercadopago.js'
import { activateFromPayment, recoverRecordFromOfficial } from '../lib/subscription-activation.js'
import { getPaymentRecord } from '../lib/payments-store.js'

/**
 * Webhook do Mercado Pago.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA ROTA NÃO CONFIA NO CORPO
 * ═══════════════════════════════════════════════════════════════════════════
 * Qualquer pessoa que descubra a URL pode fazer POST nela. Se acreditássemos
 * no `status` do corpo, bastaria enviar `{"status":"approved"}` para liberar
 * uma conta de graça.
 *
 * Então o corpo serve para UMA coisa: dizer QUAL pagamento consultar. O status
 * vem de `GET /v1/payments/{id}` na API oficial, feita por este servidor com o
 * Access Token. Mesmo que a assinatura falhasse, o pior que um atacante
 * conseguiria é nos fazer consultar um pagamento que não está aprovado.
 *
 * A assinatura HMAC é validada mesmo assim, porque é barata e é a defesa em
 * profundidade que o pedido exige.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE SEMPRE RESPONDE 200
 * ═══════════════════════════════════════════════════════════════════════════
 * O Mercado Pago reenvia a notificação enquanto não receber 2xx. Se
 * respondêssemos 500 num erro nosso, ele reenviaria para sempre. Respondemos
 * 200 quando o evento foi PROCESSADO (mesmo que o resultado seja "não ativou,
 * pagamento pendente") e 401 só quando a assinatura é inválida — nesse caso o
 * reenvio não ajuda, é ruído.
 *
 * A idempotência real está em `activateFromPayment` → `markApplied`: a
 * assinatura é estendida uma única vez, não importa quantas notificações
 * cheguem.
 */

const router = Router()

/**
 * POST /api/mercadopago/webhook
 *
 * O Mercado Pago manda dois formatos:
 *   • query string:  ?type=payment&data.id=123456
 *   • corpo JSON:    { type: 'payment', data: { id: '123456' } }
 * Aceitamos os dois.
 */
router.post('/webhook', async (req, res) => {
  try {
    if (!mpConfigured()) {
      // Sem credencial não há como consultar a API oficial. Responder 200
      // evita reenvio infinito de um evento que nunca poderíamos processar.
      console.warn('[MovieFlix] webhook recebido sem MP_ACCESS_TOKEN configurado')
      return res.status(200).json({ ok: false, reason: 'mp_unconfigured' })
    }

    const body = req.body ?? {}
    const type = String(body.type ?? req.query.type ?? '').toLowerCase()

    // Só tratamos eventos de pagamento. `merchant_order` e afins são ignorados
    // de propósito: o pagamento é a fonte da verdade.
    if (type && type !== 'payment') {
      return res.status(200).json({ ok: true, ignored: type })
    }

    const paymentId = paymentIdFromNotification(body, req.query)
    if (!paymentId) {
      return res.status(200).json({ ok: false, reason: 'no_payment_id' })
    }

    /**
     * Validação da assinatura.
     *
     * `MP_WEBHOOK_SECRET` é a "chave secreta" que o painel do Mercado Pago
     * mostra ao configurar o webhook. Sem ela configurada, não há como validar
     * — e nesse caso registramos o aviso e seguimos, porque a consulta oficial
     * abaixo continua sendo a barreira real. Com ela configurada, assinatura
     * inválida é recusada.
     */
    const secret = process.env.MP_WEBHOOK_SECRET
    if (secret) {
      const check = verifyWebhookSignature({
        signature: req.headers['x-signature'],
        requestId: req.headers['x-request-id'],
        dataId: paymentId,
        secret,
      })
      if (!check.ok) {
        console.warn('[MovieFlix] webhook com assinatura inválida:', check.reason, paymentId)
        return res.status(401).json({ ok: false, reason: 'invalid_signature' })
      }
    } else {
      console.warn(
        '[MovieFlix] MP_WEBHOOK_SECRET não configurado — assinatura não validada. ' +
          'A ativação continua dependendo da consulta oficial à API.',
      )
    }

    // Pagamento que não é nosso: ignora sem consultar a API.
    //
    // EXCEÇÃO IMPORTANTE: se o registro se perdeu (disco efêmero, deploy no
    // meio), `known` é null mesmo para um pagamento legítimo. Antes de
    // descartar, tentamos reconstruir o registro a partir do
    // `external_reference` que o Mercado Pago guarda — que é assinado pela
    // conta dele e contém userId:plano:período. Só reconstruímos se o
    // pagamento estiver `approved` e a referência for nossa.
    let known = await getPaymentRecord(paymentId)
    if (!known) {
      known = await recoverRecordFromOfficial(paymentId)
      if (!known) {
        return res.status(200).json({ ok: true, ignored: 'unknown_payment' })
      }
    }

    const result = await activateFromPayment(paymentId)

    console.log(
      '[MovieFlix] webhook',
      paymentId,
      '→',
      result.activated ? 'ATIVADO' : result.alreadyApplied ? 'já aplicado' : `não ativou (${result.reason})`,
    )

    res.status(200).json({ ok: true, ...result })
  } catch (e) {
    // Erro inesperado: 200 para não gerar reenvio infinito. A consulta
    // periódica (`reconcilePending`) e a tela do cliente cobrem o caso.
    console.error('[MovieFlix] webhook erro:', e?.message)
    res.status(200).json({ ok: false, reason: 'internal' })
  }
})

/**
 * GET /api/mercadopago/webhook
 *
 * O painel do Mercado Pago às vezes faz um GET para testar a URL. Responder
 * 200 confirma que o endpoint existe.
 */
router.get('/webhook', (_req, res) => {
  res.json({ ok: true, endpoint: 'mercadopago-webhook' })
})

export { router as mercadopagoWebhookRouter }
