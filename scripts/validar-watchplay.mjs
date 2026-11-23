#!/usr/bin/env node
/**
 * VALIDAÇÃO DE FONTE LIMPA (watchplay) — gera `public/filmes/fontes-limpas.json`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE SCRIPT EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * O provedor devolve, por título, uma lista de "opções" marcadas com `budget`:
 *
 *   watchplay      → HLS limpo. Tocamos num <video> NOSSO, atrás do proxy
 *                    /api/stream. Sem UI de provedor, sem anúncio, retomada
 *                    exata, tela cheia nativa. É o player vermelho.
 *   embedplayer    → iframe de terceiro (embedplayer2.xyz). Medido: HTML
 *                    ofuscado com packer `eval(p,a,c,k,e,d)`, trackers de
 *                    anúncio (`tracker.Royale.com`, `tracker.advertising.com`)
 *                    e `poplimit:false` — ou seja, abre pop-up. É a origem do
 *                    anúncio que o cliente vê ao tocar no player da SÉRIE.
 *   superflixapi   → `budget: danger` (só plano pago). Nunca reproduz.
 *
 * O catálogo antigo (`megaembed-disponibilidade.json`) foi gerado com o
 * critério "tem QUALQUER opção com budget success" — então um título que só
 * tinha `embedplayer` entrava como disponível e o cliente caía no player com
 * anúncio. Este script refaz a medição com o critério certo:
 *
 *   DISPONÍVEL = existe opção `watchplay` com budget success.
 *
 * Título sem watchplay fica FORA da listagem pública. É melhor não oferecer o
 * título do que oferecer um player que abre propaganda.
 *
 * ── O QUE ESTE SCRIPT PROVA E O QUE NÃO PROVA ────────────────────────────────
 *
 * Prova: o provedor listou uma fonte `watchplay` para o título, e a página
 * dessa fonte publica uma URL `.m3u8` que o nosso proxy consegue buscar.
 *
 * Não prova: que o vídeo toca no aparelho do cliente (codec, DRM, rede). Isso
 * só o cliente mede. O player mantém o aviso "não está rodando" para esse caso.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   node scripts/validar-watchplay.mjs                 # catálogo servido
 *   node scripts/validar-watchplay.mjs --limit 200     # amostra
 *   node scripts/validar-watchplay.mjs --concurrency 24
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchOptions, resolveDirectStream } from '../server/lib/stream-resolver.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public', 'filmes')
const OUT = path.join(PUBLIC, 'fontes-limpas.json')

const args = process.argv.slice(2)
const value = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const LIMIT = Number(value('--limit', 0)) || 0
const CONCURRENCY = Number(value('--concurrency', 16)) || 16

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(path.join(PUBLIC, file), 'utf8'))
  } catch {
    return []
  }
}

/**
 * Um título tem fonte limpa?
 *
 * Duas checagens, nesta ordem:
 *   1. `fetchOptions` lista `watchplay` com budget != danger (barato, 1 request).
 *   2. `resolveDirectStream` consegue extrair a URL .m3u8 (1 request a mais).
 *
 * A segunda importa: já vimos opção `watchplay:success` cuja página não
 * publicava `url:` — o player cairia em erro. Só marcamos disponível quando a
 * URL existe de fato.
 */
async function hasCleanSource({ tmdbId, season, episode }) {
  try {
    const opts = await fetchOptions({ tmdbId, season, episode })
    const wp = opts.find((o) => o.id === 'watchplay' && o.budget !== 'danger')
    if (!wp) return false
    const direct = await resolveDirectStream({ tmdbId, season, episode })
    return Boolean(direct?.url)
  } catch {
    return false
  }
}

/** Executa `fn` sobre `items` com no máximo `n` em paralelo. */
async function pool(items, n, fn) {
  const out = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

async function main() {
  const movies = await readJson('filmes.light.json')
  const series = await readJson('series.light.json')

  // Só medimos o que o catálogo já considera disponível — não faz sentido
  // gastar 26 mil requisições em títulos que já estão fora da listagem.
  let prev = { filmes: [], series: [] }
  try {
    prev = JSON.parse(await fs.readFile(path.join(PUBLIC, 'megaembed-disponibilidade.json'), 'utf8'))
  } catch {
    /* sem arquivo anterior: mede tudo */
  }
  const prevMovies = new Set((prev.filmes ?? []).map(String))
  const prevSeries = new Set((prev.series ?? []).map(String))

  let movieList = movies.filter((m) => !prevMovies.size || prevMovies.has(String(m.tmdb_id)))
  let seriesList = series.filter((s) => !prevSeries.size || prevSeries.has(String(s.tmdb_id)))

  if (LIMIT) {
    movieList = movieList.slice(0, LIMIT)
    seriesList = seriesList.slice(0, LIMIT)
  }

  console.log(`medindo ${movieList.length} filmes e ${seriesList.length} séries (concorrência ${CONCURRENCY})`)

  let done = 0
  const total = movieList.length + seriesList.length
  const tick = () => {
    done++
    if (done % 200 === 0) console.log(`  ${done}/${total}`)
  }

  const movieOk = await pool(movieList, CONCURRENCY, async (m) => {
    const ok = await hasCleanSource({ tmdbId: m.tmdb_id })
    tick()
    return ok ? String(m.tmdb_id) : null
  })

  const seriesOk = await pool(seriesList, CONCURRENCY, async (s) => {
    const eps = (s.episodes_available ?? []).slice(0, 3)
    if (!eps.length) {
      tick()
      return null
    }
    /*
      POR QUE 3 EPISÓDIOS E NÃO SÓ O PRIMEIRO.

      Medido em 2026-11-23: muitas séries têm `watchplay` no E2/E3 mas não no
      E1 (o provedor ainda não subiu o primeiro). Olhar só o E1 descartava a
      série inteira — 171 séries "disponíveis" quando havia muito mais.

      Guardamos a LISTA de episódios com fonte limpa, não um booleano: o
      player consulta por episódio, e um episódio sem fonte precisa dizer isso
      ao cliente em vez de abrir o embed com anúncio.
    */
    const clean = []
    for (const ep of eps) {
      const [season, episode] = String(ep).split('/').map(Number)
      if (await hasCleanSource({ tmdbId: s.tmdb_id, season, episode })) clean.push(String(ep))
    }
    tick()
    return clean.length ? { id: String(s.tmdb_id), eps: clean } : null
  })

  const filmes = movieOk.filter(Boolean)
  const seriesIds = seriesOk.filter(Boolean).map((s) => s.id)
  /** Episódios com fonte limpa, por série: `{ "5920": ["1/1","1/2"] }`. */
  const episodios = Object.fromEntries(seriesOk.filter(Boolean).map((s) => [s.id, s.eps]))

  const payload = {
    gerado_em: new Date().toISOString(),
    provedor: 'playerflix/watchplay',
    criterio:
      'DISPONÍVEL = o provedor listou a opção watchplay com budget success E a página dela publica uma URL .m3u8 que o proxy consegue buscar. Títulos que só têm embedplayer (iframe com anúncio) ou superflixapi (budget danger) ficam FORA.',
    reproducao_validada: false,
    motivo_nao_validado:
      'A prova de reprodução exige um aparelho com o vídeo tocando. Aqui provamos que a fonte existe e que a URL do stream responde; codec, DRM e rede só o cliente mede.',
    medidos: { filmes: movieList.length, series: seriesList.length },
    filmes,
    series: seriesIds,
    episodios,
  }

  await fs.writeFile(OUT, JSON.stringify(payload, null, 0))
  console.log(`\nfilmes com fonte limpa: ${filmes.length}/${movieList.length}`)
  console.log(`séries com fonte limpa: ${seriesIds.length}/${seriesList.length}`)
  console.log(`gravado em ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
