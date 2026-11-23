/**
 * Testes da variedade do catálogo (item 4).
 *
 * Roda com `node scripts/test-variety.mjs`. Não precisa de servidor nem de
 * banco: exercita a matemática do embaralhamento, que é onde os erros moram.
 *
 * O que cada bloco prova:
 *
 *  1. DETERMINISMO — a mesma semente devolve sempre a mesma ordem. É o que
 *     garante que a paginação não repita nem pule títulos.
 *  2. VARIEDADE — sementes diferentes devolvem ordens diferentes. É o que faz
 *     cada acesso mostrar outra combinação.
 *  3. INTEGRIDADE — a permutação não perde, não duplica e não inventa item.
 *     Nenhum título é removido para "variar".
 *  4. PAGINAÇÃO — fatiar a lista permutada em páginas cobre o catálogo inteiro
 *     exatamente uma vez, sem repetição entre páginas.
 *  5. AMOSTRAGEM — `sampleWithSeed` devolve `count` itens distintos do pool.
 *  6. ESTABILIDADE ENTRE PÁGINAS — duas chamadas com a mesma semente e offsets
 *     diferentes não compartilham nenhum item.
 */

import { shuffleWithSeed, sampleWithSeed, hashSeed, mulberry32 } from '../server/lib/shuffle.js'

let pass = 0
let fail = 0

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Catálogo sintético de 1.200 títulos, como o real (18k filmes). */
const CATALOG = Array.from({ length: 1200 }, (_, i) => ({
  tmdb_id: 100000 + i,
  title: `Título ${i}`,
  popularity: 1000 - i,
}))

console.log('\n── 1. Determinismo ─────────────────────────────────────────────')
{
  const a = shuffleWithSeed(CATALOG, 'sessao-abc')
  const b = shuffleWithSeed(CATALOG, 'sessao-abc')
  check('mesma semente → mesma ordem', JSON.stringify(a) === JSON.stringify(b))
  check('ordem realmente mudou em relação à original', a[0].tmdb_id !== CATALOG[0].tmdb_id)
}

console.log('\n── 2. Variedade entre acessos ──────────────────────────────────')
{
  const a = shuffleWithSeed(CATALOG, 'acesso-1')
  const b = shuffleWithSeed(CATALOG, 'acesso-2')
  const c = shuffleWithSeed(CATALOG, 'acesso-3')
  check('sementes diferentes → ordens diferentes', JSON.stringify(a) !== JSON.stringify(b))
  check('três acessos → três primeiras posições distintas',
    new Set([a[0].tmdb_id, b[0].tmdb_id, c[0].tmdb_id]).size === 3)

  // Os 20 primeiros de cada acesso devem diferir bastante.
  const topA = new Set(a.slice(0, 20).map((x) => x.tmdb_id))
  const topB = b.slice(0, 20).filter((x) => topA.has(x.tmdb_id)).length
  check('top 20 de dois acessos quase não se sobrepõe', topB <= 3, `sobreposição=${topB}`)
}

console.log('\n── 3. Integridade (nada é perdido) ─────────────────────────────')
{
  const out = shuffleWithSeed(CATALOG, 'qualquer')
  check('mesmo tamanho', out.length === CATALOG.length, `${out.length} vs ${CATALOG.length}`)
  const ids = new Set(out.map((x) => x.tmdb_id))
  check('sem duplicatas', ids.size === CATALOG.length, `${ids.size} únicos`)
  check('todos os títulos presentes',
    CATALOG.every((x) => ids.has(x.tmdb_id)))
  check('não muta a lista original', CATALOG[0].tmdb_id === 100000)
}

console.log('\n── 4. Paginação cobre tudo exatamente uma vez ──────────────────')
{
  const seed = 'sessao-paginacao'
  const ordered = shuffleWithSeed(CATALOG, seed)
  const PAGE = 60
  const seen = []
  for (let offset = 0; offset < ordered.length; offset += PAGE) {
    seen.push(...ordered.slice(offset, offset + PAGE))
  }
  check('todas as páginas somam o catálogo', seen.length === CATALOG.length)
  check('nenhum item repetido entre páginas',
    new Set(seen.map((x) => x.tmdb_id)).size === CATALOG.length)
  check('ordem das páginas é a ordem permutada',
    seen[0].tmdb_id === ordered[0].tmdb_id &&
      seen[PAGE].tmdb_id === ordered[PAGE].tmdb_id)
}

console.log('\n── 5. Amostragem para as fileiras da home ──────────────────────')
{
  const s1 = sampleWithSeed(CATALOG, 20, 'home:popular')
  const s2 = sampleWithSeed(CATALOG, 20, 'home:popular')
  check('amostra tem o tamanho pedido', s1.length === 20)
  check('amostra é determinística', JSON.stringify(s1) === JSON.stringify(s2))
  check('amostra não tem repetidos', new Set(s1.map((x) => x.tmdb_id)).size === 20)

  const s3 = sampleWithSeed(CATALOG, 20, 'home:recent')
  check('fileiras diferentes → amostras diferentes',
    JSON.stringify(s1) !== JSON.stringify(s3))

  const big = sampleWithSeed(CATALOG.slice(0, 10), 20, 'x')
  check('count > pool devolve o pool inteiro', big.length === 10)
}

console.log('\n── 6. Estabilidade entre páginas de uma mesma sessão ────────────')
{
  const seed = 'sessao-estavel'
  const p1 = shuffleWithSeed(CATALOG, seed).slice(0, 60)
  const p2 = shuffleWithSeed(CATALOG, seed).slice(60, 120)
  const overlap = p1.filter((x) => p2.some((y) => y.tmdb_id === x.tmdb_id))
  check('página 1 e página 2 não compartilham títulos', overlap.length === 0,
    `${overlap.length} repetidos`)
}

console.log('\n── 7. PRNG e hash ──────────────────────────────────────────────')
{
  check('hash é estável', hashSeed('abc') === hashSeed('abc'))
  check('hash difere por entrada', hashSeed('abc') !== hashSeed('abd'))
  const r = mulberry32(42)
  const vals = Array.from({ length: 5 }, () => r())
  check('PRNG fica em [0,1)', vals.every((v) => v >= 0 && v < 1))
  const r2 = mulberry32(42)
  check('PRNG é reproduzível', vals.every((v) => v === r2()))
}

console.log(`\n${'─'.repeat(64)}`)
console.log(`  ${pass} passaram · ${fail} falharam`)
console.log(`${'─'.repeat(64)}\n`)

process.exit(fail === 0 ? 0 : 1)
