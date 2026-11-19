#!/usr/bin/env node
/**
 * Testes da rota de capas usada pelo app de TV — `/api/catalog/posters`.
 *
 *   node scripts/test-tv-posters.mjs [baseUrl]
 *
 * Padrão: http://127.0.0.1:3999 (suba com `PORT=3999 node server/index.js`).
 *
 * O que é verificado:
 *   1. capa de FILME por tmdb_id;
 *   2. capa de SÉRIE por tmdb_id (o caso que mais falhava na TV);
 *   3. lote misto filme + série na mesma chamada;
 *   4. id inexistente vai para `missing`, sem quebrar a resposta;
 *   5. entrada vazia e entrada com lixo não derrubam a rota;
 *   6. COBERTURA: pega 40 títulos reais do catálogo (20 filmes + 20 séries) e
 *      confere que TODOS voltam com capa — é o que garante "todas as capas
 *      aparecem no histórico e nos favoritos";
 *   7. as rotas antigas do catálogo continuam respondendo igual (regressão).
 */

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3999').replace(/\/$/, '')

let failures = 0
let checks = 0

function check(name, cond, detail = '') {
  checks++
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function json(path) {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`)
  return r.json()
}

async function main() {
  console.log(`MovieFlix TV — testes da rota de capas (${BASE})`)
  console.log('='.repeat(60))

  // ── 1. filme ──────────────────────────────────────────────────────────────
  console.log('\n[1] Capa de filme por tmdb_id')
  const one = await json('/api/catalog/posters?ids=603')
  check('Matrix (603) tem capa', typeof one.posters['603'] === 'string' && one.posters['603'].startsWith('https://'), JSON.stringify(one))
  check('nada em missing', Array.isArray(one.missing) && one.missing.length === 0)

  // ── 2. série ──────────────────────────────────────────────────────────────
  console.log('\n[2] Capa de série por tmdb_id')
  const seriesList = await json('/api/catalog/series?limit=3')
  const s0 = seriesList.items[0]
  const sres = await json(`/api/catalog/posters?ids=${s0.tmdb_id}`)
  check(`série "${s0.title}" (${s0.tmdb_id}) tem capa`, Boolean(sres.posters[String(s0.tmdb_id)]), JSON.stringify(sres))

  // ── 3. lote misto ─────────────────────────────────────────────────────────
  console.log('\n[3] Lote misto filme + série')
  const mixed = await json(`/api/catalog/posters?ids=603,${s0.tmdb_id}`)
  check('as duas capas voltam na mesma chamada', Object.keys(mixed.posters).length === 2, JSON.stringify(mixed))

  // ── 4. inexistente ────────────────────────────────────────────────────────
  console.log('\n[4] Id inexistente')
  const miss = await json('/api/catalog/posters?ids=999999999')
  check('vai para missing', miss.missing.includes(999999999), JSON.stringify(miss))
  check('não inventa capa', Object.keys(miss.posters).length === 0)

  // ── 5. entradas degeneradas ───────────────────────────────────────────────
  console.log('\n[5] Entradas degeneradas')
  const empty = await json('/api/catalog/posters')
  check('sem ids → resposta vazia válida', empty.posters && empty.missing.length === 0)
  const junk = await json('/api/catalog/posters?ids=abc,,-1,603')
  check('lixo é ignorado e o id válido resolve', Boolean(junk.posters['603']), JSON.stringify(junk))

  // ── 6. cobertura real ─────────────────────────────────────────────────────
  console.log('\n[6] Cobertura: 20 filmes + 20 séries do catálogo')
  const movies = await json('/api/catalog/movies?limit=20')
  const series = await json('/api/catalog/series?limit=20')
  const ids = [...movies.items, ...series.items].map((t) => t.tmdb_id).filter(Boolean)
  check('pegou 40 títulos', ids.length === 40, `ids=${ids.length}`)

  const cov = await json(`/api/catalog/posters?ids=${ids.join(',')}`)
  const got = Object.keys(cov.posters).length
  check(`todas as 40 capas resolvidas (obtidas: ${got})`, got === 40, `missing=${JSON.stringify(cov.missing)}`)

  // As URLs precisam ser realmente carregáveis (não só string).
  const sample = Object.values(cov.posters).slice(0, 3)
  for (const url of sample) {
    const r = await fetch(url, { method: 'HEAD' })
    check(`capa carrega (${r.status}) ${url.split('/').pop()}`, r.ok, `HTTP ${r.status}`)
  }

  // ── 7. regressão das rotas antigas ────────────────────────────────────────
  console.log('\n[7] Regressão: rotas antigas do catálogo')
  const m = await json('/api/catalog/movies?limit=2')
  check('GET /api/catalog/movies responde com total e items', typeof m.total === 'number' && Array.isArray(m.items))
  const g = await json('/api/catalog/genres')
  check('GET /api/catalog/genres responde com lista', Array.isArray(g.genres) && g.genres.length > 0)
  const q = await json('/api/catalog/movies?q=matrix&limit=3')
  check('busca por texto continua funcionando', q.total >= 1, `total=${q.total}`)

  console.log('\n' + '='.repeat(60))
  console.log(`${checks} verificações, ${failures} falha(s)`)
  if (failures > 0) {
    console.log('RESULTADO: FALHOU')
    process.exit(1)
  }
  console.log('RESULTADO: PASSOU')
}

main().catch((e) => {
  console.error('ERRO:', e.message)
  process.exit(1)
})
