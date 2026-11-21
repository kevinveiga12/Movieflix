/**
 * Testes da resolução de servidores (server/lib/providers.js).
 *
 * ── O QUE ESTES TESTES PROTEGEM ──────────────────────────────────────────────
 *
 * O bug de 2026-11-21: o provedor principal (myembed.biz) passou a devolver uma
 * página de cloaking — um blog de investimentos falso — e o cliente abria o
 * filme e via o blog. Não havia segunda opção para trocar.
 *
 * Estes testes garantem que:
 *   1. a lista SEMPRE traz mais de uma opção (há para onde trocar);
 *   2. uma opção comprovadamente quebrada (cloaking) NÃO lidera a lista;
 *   3. o servidor principal do catálogo lidera quando está saudável;
 *   4. a URL de cada opção é montada com o padrão certo de filme e de série;
 *   5. um provedor sem catálogo de séries não gera URL de episódio.
 *
 * A verificação de rede é substituída por um dublê determinístico: o teste não
 * depende de os provedores estarem no ar hoje.
 */

import assert from 'node:assert/strict'
import { PROVIDERS, resolveSources } from '../server/lib/providers.js'

let pass = 0
let fail = 0

function check(name, fn) {
  try {
    fn()
    console.log(`  OK   ${name}`)
    pass++
  } catch (e) {
    console.log(`  FALHA ${name}\n       ${e.message}`)
    fail++
  }
}

async function checkAsync(name, fn) {
  try {
    await fn()
    console.log(`  OK   ${name}`)
    pass++
  } catch (e) {
    console.log(`  FALHA ${name}\n       ${e.message}`)
    fail++
  }
}

console.log('\n[1] Catálogo de provedores')

check('há pelo menos 2 provedores (senão não existe troca de servidor)', () => {
  assert.ok(PROVIDERS.length >= 2, `apenas ${PROVIDERS.length} provedor(es)`)
})

check('todo provedor tem id, label, base e montador de filme', () => {
  for (const p of PROVIDERS) {
    assert.ok(p.id, 'id ausente')
    assert.ok(p.label, `label ausente em ${p.id}`)
    assert.ok(/^https:\/\//.test(p.base), `base inválida em ${p.id}: ${p.base}`)
    assert.equal(typeof p.movie, 'function', `movie ausente em ${p.id}`)
  }
})

check('os ids são únicos', () => {
  const ids = PROVIDERS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(', ')}`)
})

check('watchplay não anuncia episódio (não tem catálogo de séries)', () => {
  const wp = PROVIDERS.find((p) => p.id === 'watchplay')
  assert.ok(wp, 'watchplay ausente')
  assert.equal(wp.episode, null, 'watchplay não deve montar URL de episódio')
})

console.log('\n[2] Montagem de URL')

check('filme usa o padrão de cada provedor', () => {
  const wp = PROVIDERS.find((p) => p.id === 'watchplay')
  assert.equal(wp.movie('550'), '/movie/550')
  const sb = PROVIDERS.find((p) => p.id === 'streambetter')
  assert.equal(sb.movie('550'), '/filme/550?lang=pt-BR')
})

check('série usa temporada e episódio', () => {
  const sb = PROVIDERS.find((p) => p.id === 'streambetter')
  assert.equal(sb.episode('1399', 2, 5), '/serie/1399/2/5?lang=pt-BR')
})

console.log('\n[3] Resolução (com verificação de rede dublada)')

// Dublê: marca como quebrado o que contém "quebrado", saudável o resto.
// O HTML precisa passar do guarda de "corpo vazio" (200 bytes) do provedor.
const PAD = '<!-- ' + 'x'.repeat(300) + ' -->'
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes('quebrado')) {
    return {
      ok: true,
      text: async () =>
        `<html><head><title>Investidor.blog — FIIs, Ações e Educação Financeira</title></head><body>${PAD}</body></html>`,
    }
  }
  return {
    ok: true,
    text: async () =>
      `<html><head><script>var url:"https://cdn.example/x.m3u8"</script></head><body><video></video>${PAD}</body></html>`,
  }
}

await checkAsync('filme devolve mais de uma opção', async () => {
  const list = await resolveSources({ tmdbId: 550 })
  assert.ok(list.length >= 2, `apenas ${list.length} opção(ões)`)
})

await checkAsync('toda opção tem id, label, url e verified', async () => {
  const list = await resolveSources({ tmdbId: 550 })
  for (const s of list) {
    assert.ok(s.id, 'id ausente')
    assert.ok(s.label, `label ausente em ${s.id}`)
    assert.ok(/^https:\/\//.test(s.url), `url inválida em ${s.id}: ${s.url}`)
    assert.ok('verified' in s, `verified ausente em ${s.id}`)
  }
})

await checkAsync('opção quebrada (cloaking) não lidera a lista', async () => {
  const list = await resolveSources({
    tmdbId: 550,
    catalogUrl: 'https://quebrado.example/filme/550',
  })
  assert.notEqual(list[0].id, 'catalog', 'o servidor quebrado ficou em primeiro lugar')
  assert.equal(list[0].verified, true, 'a primeira opção deveria estar verificada')
})

await checkAsync('servidor principal saudável lidera a lista', async () => {
  const list = await resolveSources({
    tmdbId: 550,
    catalogUrl: 'https://saudavel.example/filme/550',
  })
  assert.equal(list[0].id, 'catalog', 'o servidor principal deveria liderar')
})

await checkAsync('série monta URL de episódio e não inclui provedor sem séries', async () => {
  const list = await resolveSources({ tmdbId: 1399, season: 1, episode: 1 })
  assert.ok(list.length >= 1, 'nenhuma opção para o episódio')
  for (const s of list) {
    assert.ok(!s.url.includes('/movie/'), `URL de filme numa série: ${s.url}`)
  }
  assert.ok(
    !list.some((s) => s.id === 'watchplay'),
    'watchplay não tem catálogo de séries e não deveria aparecer',
  )
})

await checkAsync('tmdbId inválido devolve lista vazia (não inventa URL)', async () => {
  assert.deepEqual(await resolveSources({ tmdbId: 'abc' }), [])
  assert.deepEqual(await resolveSources({ tmdbId: '' }), [])
})

globalThis.fetch = realFetch

console.log('\n' + '='.repeat(60))
console.log(`${pass} verificação(ões), ${fail} falha(s)`)
console.log(`RESULTADO: ${fail === 0 ? 'PASSOU' : 'FALHOU'}`)
process.exit(fail === 0 ? 0 : 1)
