import { getPayment } from './mercadopago.js'
import { getPaymentRecord, markApplied, upsertPayment } from './payments-store.js'
import { PLAN_DAYS } from './plan-pricing.js'

/**
 * Ativação de assinatura a partir de um pagamento Pix confirmado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA QUE NÃO PODE SER QUEBRADA
 * ═══════════════════════════════════════════════════════════════════════════
 * Nada aqui confia no que o cliente ou o webhook DIZEM. A única fonte aceita é
 * a resposta de `GET /v1/payments/{id}` na API oficial do Mercado Pago, feita
 * por este servidor com o Access Token. O corpo do webhook serve só para
 * descobrir QUAL pagamento consultar.
 *
 * Isso fecha as três formas óbvias de fraude:
 *   • abrir a página de "sucesso" → não ativa nada, ela só lê o status;
 *   • postar um webhook falso → a assinatura HMAC é validada e, mesmo que
 *     passasse, o status viria da API oficial, não do corpo;
 *   • editar o app → o acesso é gravado em `app_metadata`, que só a Service
 *     Role escreve.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONDE O ACESSO É GRAVADO
 * ═══════════════════════════════════════════════════════════════════════════
 * `app_metadata` do Supabase Auth — exatamente o mesmo campo que o painel
 * administrativo já usa (`POST /api/admin/users/:id/plan`) e que o gate de
 * reprodução (`server/lib/entitlement.js`) já lê. Não criamos um segundo
 * sistema de permissão: o Pix escreve no mesmo lugar que a concessão manual.
 *
 * Campos gravados:
 *   plan_code         'basico' | 'standard' | 'premium'
 *   plan_expires_at   ISO
 *   plan_source       'mercadopago'  (distingue de concessão manual)
 *   last_payment_id   id do pagamento que ativou
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Status do Mercado Pago que liberam acesso. Só `approved`. */
const APPROVED = 'approved'

/**
 * Consulta o pagamento na API oficial e devolve um resumo normalizado.
 *
 * Lança se a API falhar — quem chama decide se é erro transitório (tentar de
 * novo) ou definitivo.
 */
export async function fetchOfficialPayment(paymentId) {
  const p = await getPayment(paymentId)
  return {
    id: String(p.id),
    status: String(p.status ?? 'unknown'),
    statusDetail: p.status_detail ?? null,
    amountCents: Math.round(Number(p.transaction_amount ?? 0) * 100),
    currency: String(p.currency_id ?? ''),
    externalReference: p.external_reference ?? null,
    dateApproved: p.date_approved ?? null,
    dateCreated: p.date_created ?? null,
    paymentMethodId: p.payment_method_id ?? null,
    payerEmail: p.payer?.email ?? null,
    raw: p,
  }
}

/**
 * Confere se o pagamento oficial corresponde ao que registramos.
 *
 * Cada checagem existe por um motivo concreto:
 *   • external_reference → o pagamento é DESTE pedido, não de outro cliente;
 *   • valor              → ninguém paga R$ 19,90 e recebe Premium;
 *   • moeda              → BRL; um pagamento em outra moeda não vale;
 *   • plano              → o plano do registro é o que será ativado.
 *
 * Devolve { ok, reason }.
 */
export function validatePayment(record, official) {
  if (!record) return { ok: false, reason: 'unknown_payment' }
  if (official.status !== APPROVED) return { ok: false, reason: `status_${official.status}` }

  if (record.external_reference && official.externalReference !== record.external_reference) {
    return { ok: false, reason: 'external_reference_mismatch' }
  }
  if (Number(record.amount_cents) !== Number(official.amountCents)) {
    return { ok: false, reason: 'amount_mismatch' }
  }
  if (official.currency && official.currency !== 'BRL') {
    return { ok: false, reason: 'currency_mismatch' }
  }
  if (!record.user_id || !record.plan_code) {
    return { ok: false, reason: 'incomplete_record' }
  }
  return { ok: true, reason: null }
}

/**
 * Ativa a assinatura de um pagamento aprovado.
 *
 * IDEMPOTENTE: `markApplied` só deixa passar uma vez. Webhook repetido,
 * consulta periódica e clique do cliente na tela podem chamar isto em paralelo
 * — a assinatura é estendida uma única vez.
 *
 * Devolve:
 *   { activated: true,  expiresAt, planCode }   → ativou agora
 *   { activated: false, alreadyApplied: true }  → já tinha sido aplicado
 *   { activated: false, reason }                → não ativou (e por quê)
 */
export async function activateFromPayment(paymentId) {
  /**
   * Import dinâmico de propósito.
   *
   * `auth.js` puxa `supabase-server.js`, que exige `@supabase/supabase-js`. Com
   * import estático, este módulo não carrega sem `node_modules` — e o teste das
   * regras anti-fraude roda no CI antes do `npm ci`. As regras de validação são
   * lógica pura; só a escrita no Auth precisa do SDK.
   */
  const { supabaseAdmin } = await import('./auth.js')
  const admin = supabaseAdmin
  if (!admin) {
    return { activated: false, reason: 'no_service_role' }
  }

  const record = await getPaymentRecord(paymentId)
  if (!record) return { activated: false, reason: 'unknown_payment' }

  // Já aplicado: não consulta a API de novo, não estende de novo.
  if (record.applied_at) {
    return {
      activated: false,
      alreadyApplied: true,
      planCode: record.plan_code,
      expiresAt: record.plan_expires_at ?? null,
    }
  }

  let official
  try {
    official = await fetchOfficialPayment(paymentId)
  } catch (e) {
    // Erro de rede/API: NÃO ativa e NÃO marca como aplicado. A próxima
    // notificação (ou a consulta periódica) tenta de novo.
    return { activated: false, reason: 'mp_unreachable', detail: e?.message ?? null }
  }

  const check = validatePayment(record, official)
  if (!check.ok) {
    // Registra o status oficial para o painel, mas não libera nada.
    await upsertPayment(paymentId, {
      status: official.status,
      status_detail: official.statusDetail,
      last_checked_at: new Date().toISOString(),
    })
    return { activated: false, reason: check.reason, status: official.status }
  }

  const { data: current, error: readErr } = await admin.auth.admin.getUserById(record.user_id)
  if (readErr || !current?.user) {
    return { activated: false, reason: 'user_not_found' }
  }

  const meta = { ...(current.user.app_metadata ?? {}) }

  /**
   * Base do cálculo: o fim do plano atual, se ainda vigente.
   *
   * Mesma regra do painel: renovar antes do vencimento SOMA o tempo, não
   * joga fora o que o cliente já pagou. Quem paga 1 mês faltando 10 dias
   * recebe 40 dias.
   */
  const now = Date.now()
  const currentEnd = meta.plan_expires_at ? new Date(meta.plan_expires_at).getTime() : 0
  const base = Number.isFinite(currentEnd) && currentEnd > now ? currentEnd : now
  const days = PLAN_DAYS[record.period_code] ?? 30
  const expires = new Date(base + days * DAY_MS)

  meta.plan_code = record.plan_code
  meta.plan_expires_at = expires.toISOString()
  meta.plan_source = 'mercadopago'
  meta.last_payment_id = String(paymentId)
  // Pagar reativa a conta: não faz sentido cobrar de quem está bloqueado e
  // continuar bloqueado.
  delete meta.access_disabled

  const { error: writeErr } = await admin.auth.admin.updateUserById(record.user_id, {
    app_metadata: meta,
  })
  if (writeErr) {
    return { activated: false, reason: 'write_failed', detail: writeErr.message }
  }

  const applied = await markApplied(paymentId, {
    status: official.status,
    status_detail: official.statusDetail,
    approved_at: official.dateApproved,
    plan_code: record.plan_code,
    period_code: record.period_code,
    plan_expires_at: expires.toISOString(),
    user_email: current.user.email ?? record.user_email ?? null,
  })

  // Corrida: outra requisição aplicou entre a leitura e a gravação. O estado
  // final é o dela; não estendemos de novo.
  if (applied.alreadyApplied) {
    return {
      activated: false,
      alreadyApplied: true,
      planCode: applied.record?.plan_code ?? record.plan_code,
      expiresAt: applied.record?.plan_expires_at ?? null,
    }
  }

  return {
    activated: true,
    planCode: record.plan_code,
    periodCode: record.period_code,
    expiresAt: expires.toISOString(),
    days,
    userEmail: current.user.email ?? null,
  }
}

/**
 * RECUPERAÇÃO DE REGISTRO PERDIDO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O CENÁRIO QUE ISTO RESOLVE
 * ═══════════════════════════════════════════════════════════════════════════
 * O registro de pagamentos vive em `payments.json` (ver payments-store.js). Se
 * o disco for efêmero, um deploy apaga o arquivo. Aí o cliente paga, o webhook
 * chega, `getPaymentRecord` devolve null e a rota respondia
 * `ignored: unknown_payment` — o pagamento era DESCARTADO em silêncio. O
 * cliente pagou e não recebeu acesso, e ninguém ficou sabendo.
 *
 * A saída não é confiar no corpo do webhook (isso continua proibido). É que o
 * `external_reference` que gravamos na cobrança tem o formato
 * `userId:planCode:periodCode:timestamp` — ou seja, o próprio Mercado Pago
 * guarda, assinado pela conta dele, tudo que precisamos para reconstruir o
 * registro. Consultamos a API oficial, lemos a referência, e só reconstruímos
 * se ela for NOSSA e o pagamento estiver `approved`.
 *
 * O valor cobrado vem do pagamento oficial, nunca de um número inventado.
 * Devolve o registro reconstruído, ou null se não for recuperável.
 */
export async function recoverRecordFromOfficial(paymentId) {
  let official
  try {
    official = await fetchOfficialPayment(paymentId)
  } catch {
    return null
  }

  if (official.status !== APPROVED) return null
  if (official.currency && official.currency !== 'BRL') return null

  const ref = String(official.externalReference ?? '')
  // Formato exato: <uuid>:<plan>:<period>:<digits>
  const m = /^([0-9a-fA-F-]{36}):([a-z0-9_]+):([a-z0-9]+):(\d+)$/.exec(ref)
  if (!m) return null

  const [, userId, planCode, periodCode] = m
  if (!PLAN_DAYS[periodCode]) return null

  const record = await upsertPayment(paymentId, {
    user_id: userId,
    plan_code: planCode,
    period_code: periodCode,
    amount_cents: official.amountCents,
    currency: 'BRL',
    status: official.status,
    status_detail: official.statusDetail,
    external_reference: ref,
    source: 'pix',
    recovered: true,
    recovered_at: new Date().toISOString(),
  })

  console.warn(
    '[MovieFlix] registro de pagamento RECUPERADO da API oficial:',
    paymentId,
    '· plano',
    planCode,
    '· período',
    periodCode,
  )
  return record
}

/**
 * Consulta periódica de segurança.
 *
 * O webhook é o caminho principal, mas ele depende de o Mercado Pago conseguir
 * alcançar o servidor. Se a notificação se perder (deploy no meio, firewall,
 * timeout), o cliente pagaria e ficaria sem acesso — o pior desfecho possível.
 *
 * Esta função varre os pagamentos pendentes recentes e consulta cada um na API
 * oficial. É chamada:
 *   • pela tela de pagamento, enquanto o cliente espera (a cada poucos
 *     segundos, com limite);
 *   • por um intervalo no servidor, para os que ninguém está olhando.
 *
 * Só considera pagamentos das últimas 24h: um Pix de três dias atrás já
 * expirou e não vai virar aprovado.
 */
export async function reconcilePending({ maxAgeHours = 24, limit = 25 } = {}) {
  const { listPayments } = await import('./payments-store.js')
  const all = await listPayments({ limit: 500 })
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000

  const pending = all
    .filter((p) => !p.applied_at)
    .filter((p) => ['pending', 'in_process', 'authorized', 'unknown'].includes(String(p.status)))
    .filter((p) => {
      const t = new Date(p.created_at ?? 0).getTime()
      return Number.isFinite(t) && t >= cutoff
    })
    .slice(0, limit)

  const results = []
  for (const p of pending) {
    const r = await activateFromPayment(p.payment_id)
    results.push({ paymentId: p.payment_id, ...r })
  }
  return results
}
