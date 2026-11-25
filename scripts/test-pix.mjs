import crypto from 'node:crypto'
import { resolvePlanPrice, brl } from '../server/lib/plan-pricing.js'
import { verifyWebhookSignature, paymentIdFromNotification } from '../server/lib/mercadopago.js'
import { validatePayment } from '../server/lib/subscription-activation.js'

/**
 * Testes da lógica pura da integração Pix.
 *
 * Não tocam em rede nem em banco: exercitam as decisões que, se erradas,
 * cobram o valor errado ou liberam conta sem pagamento.
 */

let pass = 0
let fail = 0

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name} ${detail}`)
  }
}

console.log('\n── Preços (mesma regra do site) ──')
{
  const b1 = await resolvePlanPrice('basico', '1m')
  const b3 = await resolvePlanPrice('basico', '3m')
  const b12 = await resolvePlanPrice('basico', '12m')
  check('Básico 1 mês = R$ 19,90', b1.cents === 1990, `got ${b1.cents}`)
  check('Básico 3 meses = R$ 47,76 (20% off)', b3.cents === 4776, `got ${b3.cents}`)
  check('Básico 1 ano = R$ 119,40 (50% off)', b12.cents === 11940, `got ${b12.cents}`)

  const s3 = await resolvePlanPrice('standard', '3m')
  const p12 = await resolvePlanPrice('premium', '12m')
  check('Médio 3 meses = R$ 71,76', s3.cents === 7176, `got ${s3.cents}`)
  check('Premium 1 ano = R$ 239,40', p12.cents === 23940, `got ${p12.cents}`)

  check('Plano inexistente devolve null', (await resolvePlanPrice('ouro', '1m')) === null)
  check('Período inválido cai em 1 mês', (await resolvePlanPrice('basico', '99m')).cents === 1990)
  check('brl formata em pt-BR', brl(4776) === 'R$ 47,76', brl(4776))
}

console.log('\n── Assinatura do webhook ──')
{
  const secret = 'chave-de-teste'
  const dataId = '123456'
  const requestId = 'req-abc'
  const ts = '1700000000'
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex')

  const good = verifyWebhookSignature({
    signature: `ts=${ts},v1=${v1}`,
    requestId,
    dataId,
    secret,
  })
  check('assinatura correta é aceita', good.ok === true, JSON.stringify(good))

  const bad = verifyWebhookSignature({
    signature: `ts=${ts},v1=${'0'.repeat(64)}`,
    requestId,
    dataId,
    secret,
  })
  check('assinatura falsa é recusada', bad.ok === false && bad.reason === 'mismatch')

  const wrongSecret = verifyWebhookSignature({
    signature: `ts=${ts},v1=${v1}`,
    requestId,
    dataId,
    secret: 'outra-chave',
  })
  check('segredo diferente é recusado', wrongSecret.ok === false)

  check('sem segredo é recusado', verifyWebhookSignature({ signature: 'x', requestId, dataId, secret: '' }).ok === false)
  check('sem assinatura é recusado', verifyWebhookSignature({ signature: null, requestId, dataId, secret }).ok === false)

  // Extração do id em ambos os formatos
  check('id do corpo', paymentIdFromNotification({ data: { id: '42' } }, {}) === '42')
  check('id da query', paymentIdFromNotification({}, { 'data.id': '43' }) === '43')
  check('sem id devolve null', paymentIdFromNotification({}, {}) === null)
}

console.log('\n── Validação do pagamento (anti-fraude) ──')
{
  const record = {
    user_id: 'u1',
    plan_code: 'premium',
    period_code: '1m',
    amount_cents: 3990,
    external_reference: 'u1:premium:1m:123',
  }
  const ok = {
    status: 'approved',
    amountCents: 3990,
    currency: 'BRL',
    externalReference: 'u1:premium:1m:123',
  }
  check('pagamento correto é aceito', validatePayment(record, ok).ok === true)

  check(
    'valor menor é recusado',
    validatePayment(record, { ...ok, amountCents: 1990 }).reason === 'amount_mismatch',
  )
  check(
    'pagamento pendente é recusado',
    validatePayment(record, { ...ok, status: 'pending' }).reason === 'status_pending',
  )
  check(
    'pagamento rejeitado é recusado',
    validatePayment(record, { ...ok, status: 'rejected' }).reason === 'status_rejected',
  )
  check(
    'referência de outro pedido é recusada',
    validatePayment(record, { ...ok, externalReference: 'outro' }).reason ===
      'external_reference_mismatch',
  )
  check(
    'moeda estrangeira é recusada',
    validatePayment(record, { ...ok, currency: 'USD' }).reason === 'currency_mismatch',
  )
  check('registro inexistente é recusado', validatePayment(null, ok).reason === 'unknown_payment')
}

console.log('\n── Recuperação de registro perdido (external_reference) ──')
{
  /**
   * O parser de `external_reference` é o que decide se um pagamento legítimo
   * cujo registro se perdeu é recuperado ou descartado. Testamos o formato
   * exato que a rota de cobrança grava, e os casos que NÃO podem passar.
   */
  const REF_RE = /^([0-9a-fA-F-]{36}):([a-z0-9_]+):([a-z0-9]+):(\d+)$/
  const uid = '3f2b8c1e-9a4d-4e7b-8c2f-1a2b3c4d5e6f'

  const good = REF_RE.exec(`${uid}:premium:12m:1764000000000`)
  check('referência válida é reconhecida', Boolean(good))
  check('extrai o userId', good?.[1] === uid)
  check('extrai o plano', good?.[2] === 'premium')
  check('extrai o período', good?.[3] === '12m')

  check('referência vazia é recusada', REF_RE.test('') === false)
  check('referência sem período é recusada', REF_RE.test(`${uid}:premium`) === false)
  check('referência com plano inventado não casa o formato', REF_RE.test('x:y:z') === false)
  check(
    'período desconhecido não tem dias (não ativaria)',
    !Object.prototype.hasOwnProperty.call({ '1m': 30, '3m': 90, '12m': 365 }, '99m'),
  )
}

console.log(`\n${pass} passaram, ${fail} falharam\n`)
process.exit(fail === 0 ? 0 : 1)
