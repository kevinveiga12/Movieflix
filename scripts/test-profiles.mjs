/**
 * Testes das regras de perfil e de conteúdo infantil.
 *
 * Roda com `node scripts/test-profiles.mjs` — sem banco, sem rede: o módulo
 * `server/lib/profiles.js` é puro de propósito, para poder ser testado assim.
 *
 * O que é verificado aqui é a REGRA DE NEGÓCIO pedida pelo proprietário:
 *   Básico 1 · Médio 2+1 infantil · Premium 4+1 infantil
 * e a definição de "conteúdo infantil" usada no catálogo, na busca e no player.
 */

import assert from 'node:assert/strict'
import {
  limitsForPlan,
  canCreateProfile,
  profileSummary,
  isKidsContent,
  filterKidsContent,
  readProfiles,
  countProfiles,
  normalizeKind,
} from '../server/lib/profiles.js'

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (e) {
    failures.push({ name, error: e })
    console.log(`FAIL  ${name}\n      ${e.message}`)
  }
}

/** Perfis de mentira, só com o que a regra lê. */
const p = (kind, n = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: `${kind}-${i}`, name: `${kind} ${i}`, kind }))

console.log('\nLimites por plano')

test('Básico: 1 perfil normal, nenhum infantil', () => {
  assert.deepEqual(limitsForPlan('basico'), { adult: 1, kids: 0 })
})

test('Médio: 2 normais + 1 infantil', () => {
  assert.deepEqual(limitsForPlan('standard'), { adult: 2, kids: 1 })
})

test('Premium: 4 normais + 1 infantil', () => {
  assert.deepEqual(limitsForPlan('premium'), { adult: 4, kids: 1 })
})

test('Sem plano cai no limite do Básico (não libera tudo)', () => {
  assert.deepEqual(limitsForPlan(null), { adult: 1, kids: 0 })
  assert.deepEqual(limitsForPlan('plano-inexistente'), { adult: 1, kids: 0 })
})

test('Código do plano é lido sem diferenciar maiúsculas', () => {
  assert.deepEqual(limitsForPlan('PREMIUM'), { adult: 4, kids: 1 })
})

console.log('\nCriação de perfil — Básico')

test('Básico: primeiro perfil normal é permitido', () => {
  assert.equal(canCreateProfile('basico', [], 'adult').allowed, true)
})

test('Básico: segundo perfil normal é recusado com motivo', () => {
  const r = canCreateProfile('basico', p('adult', 1), 'adult')
  assert.equal(r.allowed, false)
  assert.match(r.reason, /plano Básico permite 1 perfil/)
})

test('Básico: perfil infantil é recusado (o plano não inclui)', () => {
  const r = canCreateProfile('basico', [], 'kids')
  assert.equal(r.allowed, false)
  assert.match(r.reason, /não inclui perfil infantil/)
})

console.log('\nCriação de perfil — Médio')

test('Médio: 2 normais permitidos, o 3º recusado', () => {
  assert.equal(canCreateProfile('standard', [], 'adult').allowed, true)
  assert.equal(canCreateProfile('standard', p('adult', 1), 'adult').allowed, true)
  assert.equal(canCreateProfile('standard', p('adult', 2), 'adult').allowed, false)
})

test('Médio: 1 infantil permitido, o 2º recusado', () => {
  assert.equal(canCreateProfile('standard', p('adult', 2), 'kids').allowed, true)
  assert.equal(canCreateProfile('standard', p('adult', 2), 'kids').allowed, true)
  const r = canCreateProfile('standard', [...p('adult', 2), ...p('kids', 1)], 'kids')
  assert.equal(r.allowed, false)
  assert.match(r.reason, /1 perfil infantil/)
})

test('Médio: o infantil NÃO consome vaga de perfil normal', () => {
  // 2 normais + 1 infantil = conta cheia, mas o infantil é contado à parte.
  const full = [...p('adult', 2), ...p('kids', 1)]
  assert.equal(countProfiles(full).adult, 2)
  assert.equal(countProfiles(full).kids, 1)
  assert.equal(canCreateProfile('standard', full, 'adult').allowed, false)
})

console.log('\nCriação de perfil — Premium')

test('Premium: 4 normais permitidos, o 5º recusado', () => {
  assert.equal(canCreateProfile('premium', p('adult', 3), 'adult').allowed, true)
  assert.equal(canCreateProfile('premium', p('adult', 4), 'adult').allowed, false)
})

test('Premium: 1 infantil permitido, o 2º recusado', () => {
  assert.equal(canCreateProfile('premium', p('adult', 4), 'kids').allowed, true)
  assert.equal(canCreateProfile('premium', [...p('adult', 4), ...p('kids', 1)], 'kids').allowed, false)
})

console.log('\nUpgrade e downgrade')

test('Downgrade: conta com 4 perfis no Premium fica bloqueada no Básico', () => {
  const four = p('adult', 4)
  assert.equal(canCreateProfile('premium', four, 'adult').allowed, false)
  // No Básico o limite é 1 e a conta já tem 4: nada novo entra.
  assert.equal(canCreateProfile('basico', four, 'adult').allowed, false)
  assert.equal(canCreateProfile('basico', four, 'kids').allowed, false)
})

test('Upgrade: conta no Básico ganha vagas ao virar Premium', () => {
  const one = p('adult', 1)
  assert.equal(canCreateProfile('basico', one, 'adult').allowed, false)
  assert.equal(canCreateProfile('premium', one, 'adult').allowed, true)
  assert.equal(canCreateProfile('premium', one, 'kids').allowed, true)
})

console.log('\nResumo para a tela')

test('profileSummary devolve limites, uso e os dois bloqueios', () => {
  const s = profileSummary('standard', [...p('adult', 2), ...p('kids', 1)])
  assert.equal(s.plan, 'standard')
  assert.equal(s.planLabel, 'Médio')
  assert.deepEqual(s.limits, { adult: 2, kids: 1 })
  assert.deepEqual(s.used, { adult: 2, kids: 1, total: 3 })
  assert.equal(s.canCreateAdult.allowed, false)
  assert.equal(s.canCreateKids.allowed, false)
})

console.log('\nLeitura de app_metadata')

test('readProfiles ignora lixo e normaliza o tipo', () => {
  const list = readProfiles({
    profiles: [
      { id: 'a', name: 'Ana', kind: 'kids' },
      { id: 'b', name: '  ', kind: 'ADULT' },
      { id: 'c', name: 'Sem tipo' },
      { name: 'sem id' },
      null,
      'texto',
    ],
  })
  assert.equal(list.length, 3)
  assert.equal(list[0].kind, 'kids')
  assert.equal(list[1].name, 'Perfil')
  assert.equal(list[1].kind, 'adult')
  assert.equal(list[2].kind, 'adult')
})

test('readProfiles tolera metadata ausente ou inválida', () => {
  assert.deepEqual(readProfiles(undefined), [])
  assert.deepEqual(readProfiles({}), [])
  assert.deepEqual(readProfiles({ profiles: 'nada' }), [])
})

test('normalizeKind: só "kids" vira infantil', () => {
  assert.equal(normalizeKind('kids'), 'kids')
  assert.equal(normalizeKind('KIDS'), 'kids')
  assert.equal(normalizeKind('adult'), 'adult')
  assert.equal(normalizeKind(undefined), 'adult')
  assert.equal(normalizeKind('qualquer'), 'adult')
})

console.log('\nConteúdo infantil')

test('Animação + Família é infantil', () => {
  assert.equal(isKidsContent('Animação, Família'), true)
  assert.equal(isKidsContent({ category: 'Animação, Família, Comédia' }), true)
})

test('Animação de terror NÃO é infantil', () => {
  assert.equal(isKidsContent('Animação, Terror'), false)
  assert.equal(isKidsContent('Animação, Crime'), false)
})

test('Adulto puro não é infantil', () => {
  assert.equal(isKidsContent('Ação, Aventura'), false)
  assert.equal(isKidsContent('Drama'), false)
  assert.equal(isKidsContent(''), false)
  assert.equal(isKidsContent(null), false)
})

test('Acento não importa', () => {
  assert.equal(isKidsContent('Animacao, Familia'), true)
  assert.equal(isKidsContent('ANIMAÇÃO, FAMÍLIA'), true)
})

test('filterKidsContent mantém só os infantis', () => {
  const list = [
    { tmdb_id: 1, category: 'Animação, Família' },
    { tmdb_id: 2, category: 'Terror' },
    { tmdb_id: 3, category: 'Animação, Terror' },
    { tmdb_id: 4, category: 'Família' },
  ]
  const out = filterKidsContent(list)
  assert.deepEqual(out.map((t) => t.tmdb_id), [1, 4])
})

test('filterKidsContent tolera entrada inválida', () => {
  assert.deepEqual(filterKidsContent(null), [])
  assert.deepEqual(filterKidsContent(undefined), [])
})

console.log(`\n${passed} passaram, ${failures.length} falharam\n`)
if (failures.length) process.exit(1)
