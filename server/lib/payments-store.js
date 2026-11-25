import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Registro de pagamentos Pix.
 *
 * POR QUE UM ARQUIVO E NÃO UMA TABELA
 * O projeto não tem as tabelas `payments` / `subscriptions` no Supabase (a
 * auditoria confirmou: `plans` também não existe — os preços vivem em
 * `server/data/admin-config.json`). O pedido proíbe criar tabelas sem
 * autorização, então seguimos o padrão que o projeto já usa para o painel:
 * JSON no servidor, com `MOVIEFLIX_DATA_DIR` apontando para volume persistente.
 *
 * O QUE ISSO CUSTA (e por que está documentado)
 * Arquivo não tem transação de banco. Duas requisições simultâneas podem
 * escrever ao mesmo tempo e uma sobrescrever a outra. Mitigamos com:
 *   1. fila em memória (uma escrita por vez no processo);
 *   2. escrita atômica (arquivo temporário + rename);
 *   3. idempotência por `payment_id` — a ativação é decidida pelo registro,
 *      não pelo número de notificações recebidas.
 * Se um dia houver mais de uma instância do servidor, isso precisa virar
 * tabela. Está registrado como pendência no relatório.
 *
 * A FONTE DA VERDADE NUNCA É ESTE ARQUIVO: é a API do Mercado Pago. O arquivo
 * guarda o que já foi confirmado, para o painel e para a idempotência.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DATA_DIR = process.env.MOVIEFLIX_DATA_DIR
  ? path.resolve(process.env.MOVIEFLIX_DATA_DIR)
  : path.join(__dirname, '..', 'data')

const PAYMENTS = path.join(DATA_DIR, 'payments.json')

const EMPTY = { payments: {}, updatedAt: null }

/** Fila de escrita: garante uma operação por vez dentro do processo. */
let writeChain = Promise.resolve()

function serialize(fn) {
  const next = writeChain.then(fn, fn)
  // A cadeia não pode morrer por causa de um erro: engolimos aqui e o erro
  // real é devolvido a quem chamou.
  writeChain = next.catch(() => {})
  return next
}

async function readRaw() {
  try {
    const raw = await fs.readFile(PAYMENTS, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...EMPTY, ...parsed, payments: { ...(parsed.payments ?? {}) } }
  } catch {
    return { ...EMPTY, payments: {} }
  }
}

/**
 * Escrita atômica: grava num temporário e renomeia.
 *
 * `rename` no mesmo sistema de arquivos é atômico — um leitor nunca vê o
 * arquivo pela metade, que é o que aconteceria com `writeFile` direto se o
 * processo morresse no meio.
 */
async function writeRaw(data) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const payload = { ...data, updatedAt: new Date().toISOString() }
  const tmp = `${PAYMENTS}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await fs.rename(tmp, PAYMENTS)
  return payload
}

/** Todos os pagamentos, do mais recente para o mais antigo. */
export async function listPayments({ limit = 200 } = {}) {
  const data = await readRaw()
  return Object.values(data.payments)
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, limit)
}

/** Um pagamento pelo id do Mercado Pago. */
export async function getPaymentRecord(paymentId) {
  const data = await readRaw()
  return data.payments[String(paymentId)] ?? null
}

/** Pagamentos de um usuário (histórico da conta). */
export async function paymentsForUser(userId) {
  const data = await readRaw()
  return Object.values(data.payments)
    .filter((p) => p.user_id === userId)
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
}

/**
 * Cria ou atualiza o registro de um pagamento.
 *
 * `patch` é mesclado sobre o registro existente. Devolve o registro final.
 * A criação é feita com `status: 'pending'` — NUNCA com acesso liberado. Quem
 * libera é `activateFromPayment`, e só depois de consultar a API oficial.
 */
export async function upsertPayment(paymentId, patch) {
  return serialize(async () => {
    const data = await readRaw()
    const key = String(paymentId)
    const now = new Date().toISOString()
    const existing = data.payments[key] ?? null

    const merged = {
      ...(existing ?? {}),
      ...patch,
      payment_id: key,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }

    data.payments[key] = merged
    await writeRaw(data)
    return merged
  })
}

/**
 * Marca o pagamento como aplicado (assinatura ativada).
 *
 * IDEMPOTÊNCIA: se `applied_at` já existe, devolve `{ alreadyApplied: true }`
 * sem tocar em nada. É isto que impede o webhook duplicado (o Mercado Pago
 * reenvia notificação até receber 200) de estender a assinatura duas vezes.
 *
 * A checagem e a gravação acontecem DENTRO da mesma seção serializada, então
 * duas notificações simultâneas não passam as duas pelo teste.
 */
export async function markApplied(paymentId, details) {
  return serialize(async () => {
    const data = await readRaw()
    const key = String(paymentId)
    const existing = data.payments[key]
    if (!existing) return { alreadyApplied: false, missing: true, record: null }

    if (existing.applied_at) {
      return { alreadyApplied: true, missing: false, record: existing }
    }

    const now = new Date().toISOString()
    const record = {
      ...existing,
      ...details,
      applied_at: now,
      updated_at: now,
    }
    data.payments[key] = record
    await writeRaw(data)
    return { alreadyApplied: false, missing: false, record }
  })
}

/** Resumo para o painel: quantos pagamentos por status. */
export async function paymentStats() {
  const all = await listPayments({ limit: 10_000 })
  const byStatus = {}
  let approvedCents = 0
  for (const p of all) {
    const s = String(p.status ?? 'unknown')
    byStatus[s] = (byStatus[s] ?? 0) + 1
    if (s === 'approved') approvedCents += Number(p.amount_cents ?? 0)
  }
  return { total: all.length, byStatus, approvedCents }
}
