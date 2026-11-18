/**
 * Teste da lógica de códigos de 1 mês grátis, com um mock do Supabase Auth.
 *
 * POR QUE MOCK: a geração e a validação reais exigem a SERVICE_ROLE_KEY, que só
 * existe no ambiente da Velixir. Sem ela não há como gerar um código de verdade
 * daqui. Este teste exercita a LÓGICA (hash, uso único, expiração, código de
 * outro cliente, limite de tentativas) contra um `app_metadata` em memória que
 * imita o comportamento do Supabase.
 *
 * O que este teste NÃO prova: que o Supabase real aceita a escrita. Isso foi
 * verificado em produção pelo caminho do cadastro (que grava app_metadata) e
 * pelo 403/401 das rotas administrativas.
 */
import assert from 'node:assert/strict'

// ── mock do cliente admin ────────────────────────────────────────────────────
const store = new Map() // userId -> { id, email, app_metadata }

const mockAdmin = {
  auth: {
    admin: {
      async getUserById(id) {
        const u = store.get(id)
        if (!u) return { data: { user: null }, error: { message: 'not found' } }
        return { data: { user: JSON.parse(JSON.stringify(u)) }, error: null }
      },
      async updateUserById(id, patch) {
        const u = store.get(id)
        if (!u) return { data: { user: null }, error: { message: 'not found' } }
        if (patch.app_metadata) u.app_metadata = JSON.parse(JSON.stringify(patch.app_metadata))
        return { data: { user: JSON.parse(JSON.stringify(u)) }, error: null }
      },
    },
  },
}

const { generateTrialCode, redeemTrialCode, publicCodes, TRIAL_CODE_TTL_DAYS } = await import(
  '../server/lib/trial-codes.js'
)
// O cliente é injetado por parâmetro — o módulo aceita `admin` para testes.
const genCode = (args) => generateTrialCode({ ...args, admin: mockAdmin })
const redeemCode = (args) => redeemTrialCode({ ...args, admin: mockAdmin })

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'
store.set(A, { id: A, email: 'cliente.a@example.com', app_metadata: {} })
store.set(B, { id: B, email: 'cliente.b@example.com', app_metadata: {} })

let pass = 0
let fail = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  OK   ${name}`)
    pass++
  } catch (e) {
    console.log(`  FALHA ${name} — ${e.message}`)
    fail++
  }
}

console.log('\n=== Códigos de 1 mês grátis ===\n')

// 1. gera código de 6 dígitos
const gen = await genCode({ userId: A, createdBy: 'admin@x' })
check('gera código de 6 dígitos', () => {
  assert.equal(gen.ok, true)
  assert.match(gen.code, /^\d{6}$/)
})
check(`validade de ${TRIAL_CODE_TTL_DAYS} dias`, () => {
  const dias = (new Date(gen.expiresAt) - Date.now()) / 86400000
  assert.ok(dias > TRIAL_CODE_TTL_DAYS - 0.1 && dias <= TRIAL_CODE_TTL_DAYS)
})

// 2. o código em texto puro NÃO é gravado
check('código em texto puro não é gravado', () => {
  const raw = JSON.stringify(store.get(A).app_metadata)
  assert.ok(!raw.includes(gen.code), 'o código apareceu no app_metadata!')
  assert.ok(raw.includes('"hash"'), 'o hash deveria estar gravado')
})

// 3. código de A não vale para B
const cross = await redeemCode({ userId: B, code: gen.code })
check('código de outro cliente é recusado', () => {
  assert.equal(cross.ok, false)
  assert.equal(cross.reason, 'invalid')
})

// 4. código errado
const wrong = await redeemCode({ userId: A, code: '000000' })
check('código errado é recusado', () => {
  assert.equal(wrong.ok, false)
  assert.equal(wrong.reason, 'invalid')
})

// 5. código correto libera 30 dias
const good = await redeemCode({ userId: A, code: gen.code })
check('código correto libera 30 dias', () => {
  assert.equal(good.ok, true)
  assert.equal(good.days, 30)
  const dias = (new Date(good.endsAt) - Date.now()) / 86400000
  assert.ok(dias > 29.9 && dias <= 30)
})
check('benefício gravado em app_metadata.trial', () => {
  const t = store.get(A).app_metadata.trial
  assert.equal(t.granted, true)
  assert.equal(t.source, 'admin_code')
})

// 6. uso único
const again = await redeemCode({ userId: A, code: gen.code })
check('mesmo código usado duas vezes é recusado', () => {
  assert.equal(again.ok, false)
  // já tem benefício ativo → recusa antes de olhar o código
  assert.ok(['used', 'already_active'].includes(again.reason), `reason=${again.reason}`)
})

// 7. código expirado
const gen2 = await genCode({ userId: B, createdBy: 'admin@x' })
// força expiração no passado
const metaB = store.get(B).app_metadata
metaB.trial_codes = metaB.trial_codes.map((c) => ({ ...c, expires_at: new Date(Date.now() - 1000).toISOString() }))
const expired = await redeemCode({ userId: B, code: gen2.code })
check('código expirado é recusado', () => {
  assert.equal(expired.ok, false)
  assert.equal(expired.reason, 'expired')
})

// 8. limite de tentativas
store.set('cccccccc-0000-0000-0000-000000000003', {
  id: 'cccccccc-0000-0000-0000-000000000003',
  email: 'c@example.com',
  app_metadata: {},
})
const C = 'cccccccc-0000-0000-0000-000000000003'
await genCode({ userId: C, createdBy: 'admin@x' })
let last
for (let i = 0; i < 6; i++) last = await redeemCode({ userId: C, code: '999999' })
check('bloqueia após 5 tentativas erradas', () => {
  assert.equal(last.ok, false)
  assert.equal(last.reason, 'too_many_attempts')
})

// 9. histórico não expõe hash
check('histórico do painel não expõe hash', () => {
  const pub = publicCodes(store.get(A))
  assert.ok(pub.length >= 1)
  assert.ok(!JSON.stringify(pub).includes('"hash"'))
  assert.ok(pub.some((c) => c.status === 'usado'))
})

console.log(`\n${pass} passaram, ${fail} falharam\n`)
process.exit(fail === 0 ? 0 : 1)
