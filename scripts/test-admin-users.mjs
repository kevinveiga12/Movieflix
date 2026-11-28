/**
 * Teste da busca de clientes do painel administrativo.
 *
 * ── O QUE ESTE TESTE PROVA ───────────────────────────────────────────────────
 * A regra que o administrador pediu: "escrevo o e-mail ou o nome e a lista
 * filtra na hora, mostrando só os que batem". Aqui a mesma função usada pela
 * rota (`matchesQuery` / `filterProfiles` de server/lib/user-search.js) é
 * exercitada contra uma lista de perfis no formato que `normalizeProfile()`
 * devolve.
 *
 * ── O QUE ELE NÃO PROVA ──────────────────────────────────────────────────────
 * Que o Supabase real devolve as linhas — isso é verificado em produção, com
 * sessão de administrador, chamando GET /api/admin/users?q=...
 *
 * Roda sem banco e sem rede:  node scripts/test-admin-users.mjs
 */
import assert from 'node:assert/strict'
import { fold, matchesQuery, filterProfiles } from '../server/lib/user-search.js'

const users = [
  { id: '1', email: 'maria.silva@gmail.com', name: 'Maria Silva', is_admin: false },
  { id: '2', email: 'jose.pereira@hotmail.com', name: 'José Pereira', is_admin: false },
  { id: '3', email: 'joao@empresa.com.br', name: 'João da Silva', is_admin: false },
  { id: '4', email: 'ana@teste.com', name: null, is_admin: false },
  { id: '5', email: 'veigakevin71@gmail.com', name: 'Kevin Veiga', is_admin: true },
]

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

const ids = (list) => list.map((u) => u.id).sort()

console.log('\n=== Busca de clientes (painel admin) ===\n')

check('fold remove acento e maiúsculas', () => {
  assert.equal(fold('José PEREIRA'), 'jose pereira')
  assert.equal(fold(null), '')
})

check('acha por e-mail completo', () => {
  assert.deepEqual(ids(filterProfiles(users, 'maria.silva@gmail.com')), ['1'])
})

check('acha por PEDAÇO do e-mail', () => {
  assert.deepEqual(ids(filterProfiles(users, 'hotmail')), ['2'])
})

check('acha por nome completo', () => {
  assert.deepEqual(ids(filterProfiles(users, 'Maria Silva')), ['1'])
})

check('acha por nome SEM acento (jose → José)', () => {
  assert.deepEqual(ids(filterProfiles(users, 'jose')), ['2'])
})

check('acha por nome COM acento (José)', () => {
  assert.deepEqual(ids(filterProfiles(users, 'José')), ['2'])
})

check('acha por sobrenome compartilhado (silva → 2 pessoas)', () => {
  assert.deepEqual(ids(filterProfiles(users, 'silva')), ['1', '3'])
})

check('busca é insensível a maiúsculas', () => {
  assert.deepEqual(ids(filterProfiles(users, 'MARIA')), ['1'])
})

check('vários termos precisam bater todos (maria gmail)', () => {
  assert.deepEqual(ids(filterProfiles(users, 'maria gmail')), ['1'])
  assert.deepEqual(ids(filterProfiles(users, 'maria hotmail')), [])
})

check('perfil sem nome ainda é achado pelo e-mail', () => {
  assert.deepEqual(ids(filterProfiles(users, 'ana@teste')), ['4'])
})

check('busca sem resultado devolve lista vazia', () => {
  assert.deepEqual(filterProfiles(users, 'zzzz-inexistente'), [])
})

check('campo vazio devolve a lista inteira', () => {
  assert.equal(filterProfiles(users, '').length, users.length)
  assert.equal(filterProfiles(users, '   ').length, users.length)
})

check('espaços em volta não atrapalham', () => {
  assert.deepEqual(ids(filterProfiles(users, '  kevin  ')), ['5'])
})

check('matchesQuery aceita perfil nulo sem estourar', () => {
  assert.equal(matchesQuery(null, 'x'), false)
  assert.equal(matchesQuery({ email: null, name: null }, 'x'), false)
})

console.log(`\n${pass} passaram, ${fail} falharam\n`)
if (fail > 0) process.exit(1)
