#!/usr/bin/env node
/**
 * Valida a disponibilidade de cada título no EmbedMovies e regenera
 * `public/filmes/disponibilidade.json`.
 *
 * ── Por que isto existe ────────────────────────────────────────────────────
 * O EmbedMovies NÃO publica uma API de catálogo em massa. A única forma
 * honesta de saber se um título está disponível é perguntar ao player por ele,
 * um a um, e gravar o resultado. Este script faz exatamente isso.
 *
 * ── Como a verificação funciona ────────────────────────────────────────────
 * O player (`myembed.biz`) é só um shell: ele consulta a API interna
 *
 *     GET https://playerflix.ink/inc/Ajax.php?type=movie&id={tmdb_id}
 *     GET https://playerflix.ink/inc/Ajax.php?type=tv&id={tmdb_id}&season=1&episode=1
 *
 * e essa API responde:
 *
 *     {"status":true,  "data":{..., "options":[{"embed":"https://..."}]}}   → disponível
 *     {"status":false, "message":"Requisição inválida (não é AJAX)."}       → indisponível
 *
 * O `status:false` é o mesmo para id inexistente e para título sem fonte, então
 * tratamos ambos como indisponível — que é o que importa para o catálogo.
 *
 * Exige `X-Requested-With: XMLHttpRequest` e um Referer do próprio player;
 * sem esses cabeçalhos a API recusa tudo.
 *
 * O que este script NÃO faz: não inventa título, não presume disponibilidade
 * porque o título existe no TMDB, e não marca nada como disponível sem ver
 * `status:true` com pelo menos uma opção de embed.
 *
 * Uso:
 *   node scripts/validar-disponibilidade.cjs                 # catálogo completo
 *   node scripts/validar-disponibilidade.cjs --limit 200     # amostra
 *   node scripts/validar-disponibilidade.cjs --only-movies
 *   node scripts/validar-disponibilidade.cjs --only-series
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public', 'filmes')

const API = 'https://playerflix.ink/inc/Ajax.php'
const UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

const CONCURRENCY = Number(process.env.VALIDATE_CONCURRENCY) || 10
const TIMEOUT_MS = 15000

function arg(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : process.argv[i + 1]
}

const LIMIT = Number(arg('--limit')) || Infinity
const ONLY_MOVIES = process.argv.includes('--only-movies')
const ONLY_SERIES = process.argv.includes('--only-series')

async function check(kind, id) {
  const qs =
    kind === 'movie'
      ? `type=movie&id=${id}`
      : `type=tv&id=${id}&season=1&episode=1`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${API}?${qs}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Referer: `https://playerflix.ink/${kind === 'movie' ? 'filme' : 'serie'}/${id}`,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    })
    if (!res.ok) return { id, ok: false, reason: `http_${res.status}` }
    const body = await res.json().catch(() => null)
    if (!body || body.status !== true) return { id, ok: false, reason: 'not_available' }
    const options = body.data?.options
    if (!Array.isArray(options) || options.length === 0) {
      return { id, ok: false, reason: 'no_source' }
    }
    return { id, ok: true, sources: options.length }
  } catch (e) {
    return { id, ok: false, reason: e.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

async function runPool(pairs, onDone) {
  let cursor = 0
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= pairs.length) return
      const [kind, id] = pairs[i]
      const r = await check(kind, id)
      onDone(r, kind, pairs.length)
    }
  })
  await Promise.all(workers)
}

async function main() {
  const movies = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'filmes.light.json'), 'utf8'))
  const series = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'series.light.json'), 'utf8'))

  const pairs = []
  if (!ONLY_SERIES) for (const m of movies) pairs.push(['movie', String(m.tmdb_id)])
  if (!ONLY_MOVIES) for (const s of series) pairs.push(['tv', String(s.tmdb_id)])
  const work = pairs.slice(0, LIMIT)

  console.log(
    `Verificando ${work.length} títulos (${movies.length} filmes / ${series.length} séries no catálogo)…`,
  )

  const okMovies = []
  const okSeries = []
  const failures = {}
  let done = 0
  const started = Date.now()

  await runPool(work, (r, kind, total) => {
    done++
    if (r.ok) {
      if (kind === 'movie') okMovies.push(r.id)
      else okSeries.push(r.id)
    } else {
      failures[r.reason] = (failures[r.reason] || 0) + 1
    }
    if (done % 200 === 0 || done === total) {
      const secs = ((Date.now() - started) / 1000).toFixed(0)
      console.log(
        `  ${done}/${total} — ok filmes=${okMovies.length} séries=${okSeries.length} (${secs}s)`,
      )
    }
  })

  // Temporadas/episódios: a API não devolve a lista completa de episódios numa
  // chamada só, então preservamos o mapa anterior para as séries que continuam
  // disponíveis. Nada é inventado: se não havia mapa, a série fica sem lista.
  let prevSeries = {}
  const outPath = path.join(PUBLIC, 'disponibilidade.json')
  if (fs.existsSync(outPath)) {
    try {
      prevSeries = JSON.parse(fs.readFileSync(outPath, 'utf8')).series || {}
    } catch {
      prevSeries = {}
    }
  }

  const seriesMap = {}
  for (const s of series) {
    const id = String(s.tmdb_id)
    if (!okSeries.includes(id)) continue
    if (s.episodes_available?.length) seriesMap[id] = s.episodes_available
    else if (prevSeries[id]) seriesMap[id] = prevSeries[id]
  }

  const out = {
    gerado_em: new Date().toISOString(),
    provedor: 'embedmovies',
    metodo: 'consulta individual a API do player (nao existe API publica de catalogo em massa)',
    totais: { filmes: okMovies.length, series: Object.keys(seriesMap).length },
    falhas: failures,
    filmes: okMovies,
    series: seriesMap,
    series_verificadas: okSeries,
  }

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(
    `\nGravado ${outPath}\n  filmes disponíveis: ${okMovies.length}` +
      `\n  séries disponíveis: ${Object.keys(seriesMap).length}` +
      `\n  falhas: ${JSON.stringify(failures)}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
