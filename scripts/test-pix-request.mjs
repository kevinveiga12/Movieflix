/**
 * Prova que o CPF chega ao Mercado Pago em `payer.identification`.
 *
 * Não faz chamada real: substitui `global.fetch` por um espião que captura o
 * corpo enviado a `POST /v1/payments` e devolve uma resposta Pix falsa. Assim
 * verificamos o contrato exato da requisição sem gastar dinheiro nem tocar em
 * produção.
 */
import { createPixPayment } from '../server/lib/mercadopago.js'
import { OWNER_CPF, ownerIdentification, validateCpf } from '../server/lib/cpf.js'
import { readFile } from 'node:fs/promises'

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

process.env.MP_ACCESS_TOKEN = 'APP_USR-test-token-nao-real'

let captured = null
global.fetch = async (url, init) => {
  captured = { url, init, body: JSON.parse(init.body) }
  return {
    ok: true,
    status: 201,
    text: async () =>
      JSON.stringify({
        id: 123456789,
        status: 'pending',
        date_of_expiration: captured.body.date_of_expiration,
        point_of_interaction: {
          transaction_data: { qr_code: '00020126...', qr_code_base64: 'iVBORw0KGgo=' },
        },
      }),
  }
}

console.log('\n── CPF fixo do dono da conta ──')
{
  check('OWNER_CPF é 56180761876', OWNER_CPF === '56180761876', OWNER_CPF)
  check('OWNER_CPF tem dígitos verificadores válidos', validateCpf(OWNER_CPF).ok === true)
  const ident = ownerIdentification()
  check('ownerIdentification devolve type CPF', ident.type === 'CPF')
  check('ownerIdentification devolve o CPF fixo', ident.number === '56180761876', ident.number)
}

console.log('\n── Requisição ao Mercado Pago (mock) ──')
{
  const res = await createPixPayment({
    amountCents: 4776,
    description: 'MovieFlix — Básico (3 meses)',
    email: 'cliente@movieflix.app',
    identification: ownerIdentification(),
    externalReference: 'u1:basico:3m:1764000000000',
    expiresInMinutes: 30,
    idempotencyKey: 'idem-123',
  })

  check('chamou POST /v1/payments', captured.url.endsWith('/v1/payments') && captured.init.method === 'POST')
  check('método é pix', captured.body.payment_method_id === 'pix')
  check('valor em reais (47.76)', captured.body.transaction_amount === 47.76, String(captured.body.transaction_amount))
  check(
    'CPF fixo enviado em payer.identification',
    captured.body.payer?.identification?.type === 'CPF' &&
      captured.body.payer?.identification?.number === '56180761876',
    JSON.stringify(captured.body.payer),
  )
  check('e-mail do pagador presente', captured.body.payer?.email === 'cliente@movieflix.app')
  check('external_reference presente', captured.body.external_reference === 'u1:basico:3m:1764000000000')
  check(
    'expiração em ISO 8601 com offset -00:00',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-00:00$/.test(captured.body.date_of_expiration),
    captured.body.date_of_expiration,
  )
  check('chave de idempotência enviada', captured.init.headers['X-Idempotency-Key'] === 'idem-123')
  check('Authorization usa o token do servidor', captured.init.headers.Authorization === 'Bearer APP_USR-test-token-nao-real')
  check('QR Code devolvido', res.point_of_interaction.transaction_data.qr_code === '00020126...')
}

console.log('\n── Sem CPF: identification não é inventado ──')
{
  captured = null
  await createPixPayment({
    amountCents: 1990,
    description: 'x',
    email: 'a@b.c',
    externalReference: 'r',
    idempotencyKey: 'k',
  })
  check('sem CPF, payer.identification ausente', captured.body.payer?.identification === undefined)
}

console.log('\n── Rota: CPF do cliente é ignorado ──')
{
  // A rota de cobrança não pode ler `req.body.cpf`: o CPF vem do servidor.
  const src = await readFile(new URL('../server/routes/mercadopago-pay.js', import.meta.url), 'utf8')
  check('rota não lê req.body.cpf', !/req\.body\??\.cpf/.test(src))
  check('rota usa OWNER_CPF', /const cpf = OWNER_CPF/.test(src))
  check('rota não valida CPF do cliente', !/validateCpf/.test(src))
  check('rota não devolve invalid_cpf', !/invalid_cpf/.test(src))
}

console.log(`\n${pass} passaram, ${fail} falharam\n`)
process.exit(fail === 0 ? 0 : 1)
