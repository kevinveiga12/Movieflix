import { createCardPayment, cardConfigured, mpPublicKey } from '../server/lib/mercadopago.js'

/**
 * Testes da lógica pura do pagamento com cartão.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O TESTE QUE MAIS IMPORTA AQUI
 * ══════════════════════════════════════════════════════════════════════════════
 * "o corpo enviado ao Mercado Pago não contém dado de cartão".
 *
 * O pedido proíbe que número, CVV e validade passem pelo backend do MovieFlix.
 * Isso não é uma promessa de comentário: é uma propriedade do corpo que
 * `createCardPayment` monta. Este teste intercepta o `fetch` e inspeciona o
 * corpo REAL — se alguém um dia adicionar `card_number` à função, o teste
 * falha antes de a mudança chegar em produção.
 *
 * Não toca em rede: o `fetch` é substituído por um espião.
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

/* ── Espião de fetch ──────────────────────────────────────────────────────── */
let captured = null
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  captured = { url: String(url), init }
  return {
    ok: true,
    status: 201,
    text: async () =>
      JSON.stringify({
        id: 123456789,
        status: 'approved',
        status_detail: 'accredited',
        payment_method_id: 'visa',
        card: { last_four_digits: '4242' },
      }),
  }
}

process.env.MP_ACCESS_TOKEN = 'APP_USR-test-token'
process.env.MP_PUBLIC_KEY = 'APP_USR-test-public-key'

console.log('\n── Configuração do cartão ──')
{
  check('cardConfigured exige token E chave pública', cardConfigured() === true)
  check('mpPublicKey devolve a chave pública', mpPublicKey() === 'APP_USR-test-public-key')

  const saved = process.env.MP_PUBLIC_KEY
  delete process.env.MP_PUBLIC_KEY
  check('sem chave pública, cartão fica desligado', cardConfigured() === false)
  process.env.MP_PUBLIC_KEY = saved
}

console.log('\n── O corpo NÃO pode conter dado de cartão ──')
{
  captured = null
  await createCardPayment({
    token: 'tok_abc123',
    paymentMethodId: 'visa',
    issuerId: '25',
    amountCents: 1990,
    description: 'MovieFlix — Básico (1 mês)',
    email: 'cliente@movieflix.app',
    identification: { type: 'CPF', number: '56180761876' },
    externalReference: 'uid:basico:1m:1764000000000',
    idempotencyKey: 'idem-1',
  })

  const body = JSON.parse(captured.init.body)
  const raw = captured.init.body

  check('o corpo tem o token', body.token === 'tok_abc123')
  check('o corpo tem o valor em reais', body.transaction_amount === 19.9)
  check('o corpo tem a bandeira', body.payment_method_id === 'visa')
  check('o corpo tem o issuer', body.issuer_id === '25')
  check('o corpo tem a referência externa', body.external_reference === 'uid:basico:1m:1764000000000')
  check('o corpo tem o e-mail do pagador', body.payer.email === 'cliente@movieflix.app')

  // ── As asserções que protegem o pedido ──────────────────────────────────
  check('NÃO há card_number no corpo', !('card_number' in body))
  check('NÃO há security_code no corpo', !('security_code' in body))
  check('NÃO há expiration_month no corpo', !('expiration_month' in body))
  check('NÃO há expiration_year no corpo', !('expiration_year' in body))
  check('NÃO há cardholder no corpo', !('cardholder' in body))
  check('a string crua não contém "card_number"', !raw.includes('card_number'))
  check('a string crua não contém "security_code"', !raw.includes('security_code'))
  check('a string crua não contém "cvv"', !raw.toLowerCase().includes('cvv'))

  check('parcelas fixadas em 1 (não parcelamos)', body.installments === 1)
  check('a URL é o endpoint oficial de pagamentos', captured.url.endsWith('/v1/payments'))
  check('usa POST', captured.init.method === 'POST')
  check('envia a chave de idempotência', captured.init.headers['X-Idempotency-Key'] === 'idem-1')
}

console.log('\n── Valor e arredondamento ──')
{
  const cases = [
    [1990, 19.9],
    [4776, 47.76],
    [11940, 119.4],
    [7176, 71.76],
    [23940, 239.4],
  ]
  for (const [cents, expected] of cases) {
    captured = null
    await createCardPayment({
      token: 't',
      paymentMethodId: 'visa',
      amountCents: cents,
      description: 'x',
      email: 'a@b.c',
      externalReference: 'r',
    })
    const body = JSON.parse(captured.init.body)
    check(`${cents} centavos → R$ ${expected}`, body.transaction_amount === expected)
  }
}

console.log('\n── Sem issuer e sem CPF, o corpo continua válido ──')
{
  captured = null
  await createCardPayment({
    token: 't2',
    paymentMethodId: 'master',
    amountCents: 1990,
    description: 'x',
    email: 'a@b.c',
    externalReference: 'r',
  })
  const body = JSON.parse(captured.init.body)
  check('issuer_id ausente quando não informado', !('issuer_id' in body))
  check('identification ausente quando não informada', !('identification' in body.payer))
  check('o pagador ainda tem e-mail', body.payer.email === 'a@b.c')
}

globalThis.fetch = realFetch

console.log(`\n${pass} passaram, ${fail} falharam\n`)
process.exit(fail === 0 ? 0 : 1)
