/**
 * Teste da decisão de acesso (`accessState`) — sem rede, sem banco.
 *
 * Cobre exatamente as três regras que a mudança de hoje pode quebrar:
 *   1. conta NOVA (marcada `no_trial`) → não assiste, cai na tela de planos
 *   2. conta ANTIGA (sem marca) → mantém o mês grátis em curso até o fim
 *   3. administrador → isento de tudo
 */
import assert from 'node:assert/strict'
import { accessState } from '../server/lib/entitlement.js'

const DAY = 86400000
const iso = (ms) => new Date(ms).toISOString()

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

console.log('\n=== Decisão de acesso ===\n')

// 1. Conta nova: nasceu sob a regra de liberação manual
const nova = {
  id: 'u1',
  email: 'novo@example.com',
  created_at: iso(Date.now() - 1000),
  app_metadata: { trial: { granted: false, reason: 'no_trial' } },
}
check('conta nova NÃO recebe mês grátis', () => {
  const s = accessState(nova)
  assert.equal(s.allowed, false)
  assert.equal(s.reason, 'no_trial')
})

// 2. Conta antiga: criada há 10 dias, sem marca nenhuma
const antiga = {
  id: 'u2',
  email: 'antiga@example.com',
  created_at: iso(Date.now() - 10 * DAY),
  app_metadata: {},
}
check('conta antiga mantém o mês grátis em curso', () => {
  const s = accessState(antiga)
  assert.equal(s.allowed, true)
  assert.equal(s.reason, 'trial')
  assert.ok(s.daysLeft > 19 && s.daysLeft <= 20, `daysLeft=${s.daysLeft}`)
})

// 3. Conta antiga com o mês já vencido
const vencida = {
  id: 'u3',
  email: 'vencida@example.com',
  created_at: iso(Date.now() - 40 * DAY),
  app_metadata: {},
}
check('conta antiga com mês vencido é bloqueada', () => {
  const s = accessState(vencida)
  assert.equal(s.allowed, false)
  assert.equal(s.reason, 'trial_expired')
})

// 4. Conta antiga que JÁ recebeu o benefício por código
const comCodigo = {
  id: 'u4',
  email: 'codigo@example.com',
  created_at: iso(Date.now() - 40 * DAY),
  app_metadata: {
    trial: { granted: true, started_at: iso(Date.now()), ends_at: iso(Date.now() + 30 * DAY), source: 'admin_code' },
  },
}
check('código resgatado libera mesmo em conta antiga', () => {
  const s = accessState(comCodigo)
  assert.equal(s.allowed, true)
  assert.equal(s.reason, 'trial')
})

// 5. Administrador
const admin = {
  id: 'u5',
  email: 'veigakevin71@gmail.com',
  created_at: iso(Date.now() - 400 * DAY),
  app_metadata: {},
}
check('administrador é isento (mesmo sem trial e com conta velha)', () => {
  const s = accessState(admin)
  assert.equal(s.allowed, true)
  assert.equal(s.reason, 'admin')
})

// 6. Conta desativada pelo painel
const desativada = {
  id: 'u6',
  email: 'off@example.com',
  created_at: iso(Date.now() - 5 * DAY),
  app_metadata: { access_disabled: true },
}
check('conta desativada não assiste', () => {
  const s = accessState(desativada)
  assert.equal(s.allowed, false)
  assert.equal(s.reason, 'account_disabled')
})

// 7. Plano pago vigente
const pago = {
  id: 'u7',
  email: 'pago@example.com',
  created_at: iso(Date.now() - 90 * DAY),
  app_metadata: { plan_code: 'premium', plan_expires_at: iso(Date.now() + 20 * DAY) },
}
check('plano pago vigente libera', () => {
  const s = accessState(pago)
  assert.equal(s.allowed, true)
  assert.equal(s.reason, 'plan')
})

// 8. Regra anterior (benefício por aparelho) continua reconhecida
const aparelho = {
  id: 'u8',
  email: 'ap@example.com',
  created_at: iso(Date.now() - 2 * DAY),
  app_metadata: { trial: { granted: false, reason: 'device_used' } },
}
check('marca antiga de aparelho continua bloqueando', () => {
  const s = accessState(aparelho)
  assert.equal(s.allowed, false)
  assert.equal(s.reason, 'trial_used')
})

console.log(`\n${pass} passaram, ${fail} falharam\n`)
process.exit(fail === 0 ? 0 : 1)
