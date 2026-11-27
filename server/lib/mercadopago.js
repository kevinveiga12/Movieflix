import crypto from 'node:crypto'

/**
 * Cliente da API do Mercado Pago — SOMENTE SERVIDOR.
 *
 * O Access Token vive em `MP_ACCESS_TOKEN` (variável de ambiente do servidor).
 * Ele NUNCA é devolvido ao navegador, ao app Android ou à TV: nenhuma rota
 * deste projeto expõe o token, e o frontend só recebe o QR e o código copia e
 * cola já gerados.
 *
 * Por que não usamos o SDK oficial: o projeto não tem `mercadopago` nas
 * dependências e adicionar um pacote novo a um deploy que já funciona é risco
 * desnecessário. A API REST é estável e são três chamadas (criar, consultar,
 * validar assinatura). `fetch` é nativo no Node 22 do runtime.
 */

const MP_API = 'https://api.mercadopago.com'

/** O servidor tem credencial do Mercado Pago configurada? */
export function mpConfigured() {
  return Boolean(process.env.MP_ACCESS_TOKEN)
}

/**
 * O token é de produção ou de teste?
 *
 * Serve só para o painel mostrar um aviso honesto. Credencial de TESTE em
 * produção geraria Pix que nenhum banco reconhece — o cliente pagaria e nada
 * aconteceria. O prefixo do token é a única forma de saber sem chamar a API.
 */
export function mpMode() {
  const t = process.env.MP_ACCESS_TOKEN ?? ''
  if (!t) return 'unconfigured'
  if (t.startsWith('TEST-')) return 'test'
  if (t.startsWith('APP_USR-')) return 'production'
  return 'unknown'
}

function token() {
  const t = process.env.MP_ACCESS_TOKEN
  if (!t) {
    const err = new Error(
      'Pagamento Pix indisponível: MP_ACCESS_TOKEN não configurado no servidor.',
    )
    err.code = 'mp_unconfigured'
    throw err
  }
  return t
}

/**
 * Chamada crua à API do Mercado Pago.
 *
 * Devolve o corpo já parseado. Em erro, lança com `status` e `body` para a rota
 * decidir o que mostrar — nunca repassamos a mensagem técnica do provedor para
 * a tela do cliente.
 */
async function mpFetch(path, init = {}) {
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }

  if (!res.ok) {
    const err = new Error(body?.message ?? `Mercado Pago respondeu HTTP ${res.status}`)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

/**
 * Cria uma cobrança Pix.
 *
 * `X-Idempotency-Key` evita cobrança duplicada quando o cliente toca duas vezes
 * no botão ou a rede repete a requisição: o Mercado Pago devolve a MESMA
 * cobrança em vez de criar outra.
 *
 * `date_of_expiration` é o prazo que a tela mostra em contagem regressiva. O
 * formato exigido pela API é ISO com offset `-00:00` (não `Z`).
 */
export async function createPixPayment({
  amountCents,
  description,
  email,
  firstName,
  lastName,
  identification,
  externalReference,
  expiresInMinutes = 30,
  idempotencyKey,
}) {
  const expires = new Date(Date.now() + expiresInMinutes * 60_000)
    .toISOString()
    .replace('Z', '-00:00')

  const body = {
    transaction_amount: Number((amountCents / 100).toFixed(2)),
    description,
    payment_method_id: 'pix',
    external_reference: externalReference,
    date_of_expiration: expires,
    payer: {
      email,
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
      ...(identification?.number
        ? { identification: { type: identification.type ?? 'CPF', number: identification.number } }
        : {}),
    },
  }

  return mpFetch('/v1/payments', {
    method: 'POST',
    headers: idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {},
    body: JSON.stringify(body),
  })
}

/**
 * Chave PÚBLICA do Mercado Pago.
 *
 * Diferente do Access Token, esta chave é feita para ir ao cliente: é ela que
 * autoriza a tokenização do cartão no navegador/app. Ela NÃO permite cobrar,
 * consultar pagamentos nem ler dados da conta — só criar um token de cartão.
 *
 * Sem ela, o pagamento por cartão fica desligado: não há como tokenizar, e
 * mandar o número do cartão para o nosso servidor é exatamente o que o pedido
 * proíbe.
 */
export function mpPublicKey() {
  return process.env.MP_PUBLIC_KEY ?? ''
}

/** O pagamento por cartão está disponível? Exige token E chave pública. */
export function cardConfigured() {
  return Boolean(process.env.MP_ACCESS_TOKEN && process.env.MP_PUBLIC_KEY)
}

/**
 * Cria um pagamento com CARTÃO a partir de um token.
 *
 * O QUE ESTE SERVIDOR NUNCA VÊ
 * Número do cartão, CVV, validade e nome do titular NÃO passam por aqui. O
 * cliente tokeniza direto no Mercado Pago (SDK JS no site, `/v1/card_tokens`
 * com a chave pública no app) e envia apenas o `token` — um identificador de
 * uso único, válido por poucos minutos, que não permite reconstruir o cartão.
 *
 * Se algum dia alguém adicionar `card_number` a este corpo, o Mercado Pago
 * recusa a requisição: o endpoint de pagamento com token não aceita PAN.
 *
 * `installments` é limitado a 1 de propósito: o MovieFlix vende assinatura
 * pré-paga, não parcelamento. Parcelar exigiria juros e mudaria o valor
 * cobrado — o que o pedido proíbe.
 */
export async function createCardPayment({
  token: cardToken,
  paymentMethodId,
  issuerId,
  amountCents,
  description,
  email,
  firstName,
  lastName,
  identification,
  externalReference,
  idempotencyKey,
}) {
  const body = {
    transaction_amount: Number((amountCents / 100).toFixed(2)),
    token: cardToken,
    description,
    installments: 1,
    payment_method_id: paymentMethodId,
    external_reference: externalReference,
    ...(issuerId ? { issuer_id: String(issuerId) } : {}),
    payer: {
      email,
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
      ...(identification?.number
        ? { identification: { type: identification.type ?? 'CPF', number: identification.number } }
        : {}),
    },
  }

  return mpFetch('/v1/payments', {
    method: 'POST',
    headers: idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {},
    body: JSON.stringify(body),
  })
}

/** Consulta um pagamento direto na API oficial (fonte da verdade). */
export async function getPayment(id) {
  return mpFetch(`/v1/payments/${encodeURIComponent(String(id))}`)
}

/**
 * Valida o Access Token com uma chamada SOMENTE DE LEITURA.
 *
 * `GET /users/me` é o endpoint mais barato que prova duas coisas de uma vez:
 * que o token é aceito (não é 401) e a qual conta ele pertence. Não cria
 * cobrança, não altera nada.
 *
 * Devolve apenas dados não sensíveis — nunca o token, nunca o e-mail completo.
 * O `site_id`/`country_id` é o que distingue produção de teste na prática.
 */
export async function validateAccessToken() {
  if (!mpConfigured()) {
    return { ok: false, reason: 'unconfigured', mode: 'unconfigured' }
  }
  try {
    const me = await mpFetch('/users/me')
    return {
      ok: true,
      reason: null,
      mode: mpMode(),
      userId: me?.id ? String(me.id) : null,
      nickname: me?.nickname ?? null,
      siteId: me?.site_id ?? null,
      countryId: me?.country_id ?? null,
      // `tags` traz "test_user" em contas de teste — sinal mais confiável que o prefixo.
      isTestUser: Array.isArray(me?.tags) ? me.tags.includes('test_user') : null,
    }
  } catch (e) {
    return {
      ok: false,
      reason: e?.status === 401 ? 'invalid_token' : 'api_error',
      status: e?.status ?? null,
      mode: mpMode(),
    }
  }
}

/**
 * Valida a assinatura da notificação (webhook).
 *
 * O Mercado Pago assina `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com
 * HMAC-SHA256 usando a "chave secreta" configurada no painel de webhooks.
 *
 * Sem esta validação, qualquer pessoa que descubra a URL poderia postar
 * "pagamento aprovado" e liberar conta de graça. Por isso a rota do webhook
 * NÃO confia no corpo: ela só usa o `data.id` e depois consulta a API oficial.
 *
 * Devolve { ok, reason } — nunca lança, para a rota responder 200/401 sem
 * derrubar o processo.
 */
export function verifyWebhookSignature({ signature, requestId, dataId, secret }) {
  if (!secret) return { ok: false, reason: 'no_secret' }
  if (!signature) return { ok: false, reason: 'no_signature' }
  if (!dataId) return { ok: false, reason: 'no_data_id' }

  const parts = {}
  for (const chunk of String(signature).split(',')) {
    const idx = chunk.indexOf('=')
    if (idx === -1) continue
    parts[chunk.slice(0, idx).trim()] = chunk.slice(idx + 1).trim()
  }

  const ts = parts.ts
  const v1 = parts.v1
  if (!ts || !v1) return { ok: false, reason: 'malformed' }

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId ?? ''};ts:${ts};`
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex')

  // timingSafeEqual exige buffers do mesmo tamanho — comparar antes evita throw.
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(String(v1), 'utf8')
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' }

  return crypto.timingSafeEqual(a, b) ? { ok: true, reason: null } : { ok: false, reason: 'mismatch' }
}

/**
 * Extrai o id do pagamento de uma notificação.
 *
 * O Mercado Pago manda o id em `data.id` (corpo) e também em `?data.id=`
 * (query). Aceitamos os dois porque o formato varia entre versões do painel.
 */
export function paymentIdFromNotification(body, query) {
  const fromBody = body?.data?.id
  const fromQuery = query?.['data.id'] ?? query?.id
  const id = fromBody ?? fromQuery
  return id ? String(id) : null
}
