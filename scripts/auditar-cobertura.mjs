/**
 * AUDITORIA DE COBERTURA — mede o que REALMENTE reproduz.
 *
 * ── POR QUE ESTE SCRIPT EXISTE ──────────────────────────────────────────────
 *
 * O `medir-cobertura.mjs` antigo perguntava ao `playerflix.ink` (o Ajax) quais
 * opções existiam. Medido em produção: esse host está bloqueado a partir do pod
 * da Velixir (HTTP 000). Com a lista vazia, o script classificava quase tudo
 * como "sem fonte" — e foi assim que se concluiu, errado, que séries tinham 5%
 * de cobertura.
 *
 * A produção não usa mais o Ajax como caminho principal: ela monta a URL por
 * convenção (`/movie/{id}`, `/tvshow/{id}/{t}/{e}`) e extrai o m3u8 do HTML.
 * Este script mede exatamente esse caminho, e vai além do "tem m3u8":
 *
 *   1. fonte encontrada   → a página do player respondeu 200
 *   2. fonte validada     → o m3u8 contém #EXTM3U
 *   3. segmento acessível → o primeiro segmento responde 200 com bytes
 *   4. segmento é vídeo   → magic bytes de MP4/fMP4 (styp/ftyp) ou TS (0x47)
 *
 * Só conta como FUNCIONAL quem passa nos quatro. HTTP 200 sozinho não conta.
 *
 * Uso:
 *   node scripts/auditar-cobertura.mjs --filmes 60 --series 40 --episodios 3
 *   node scripts/auditar-cobertura.mjs --json out.json
 */

import fs from 'node:fs/promises'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const args = process.argv.slice(2)
function arg(name, def) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const N_FILMES = Number(arg('filmes', 60))
const N_SERIES = Number(arg('series', 40))
const N_EP = Number(arg('episodios', 3))
const CONCURRENCY = Number(arg('concorrencia', 6))
const JSON_OUT = arg('json', null)

async function get(url, referer, { bin = false, timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Referer: referer, Accept: '*/*' },
    })
    const body = bin ? Buffer.from(await res.arrayBuffer()) : await res.text()
    return { status: res.status, ct: res.headers.get('content-type'), body }
  } catch (e) {
    return { status: 0, err: String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/** Extrai o m3u8 do HTML do player de verdade. */
function extractM3u8(html) {
  if (typeof html !== 'string') return null
  const m = html.match(/url\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i)
  if (!m) return null
  const url = m[1].replace(/\\\//g, '/')
  return /^https:\/\//.test(url) ? url : null
}

/** Magic bytes: fMP4 (styp/ftyp), MPEG-TS (0x47), WebM (1A45DFA3). */
function looksLikeVideo(buf) {
  if (!buf || buf.length < 12) return false
  const s = buf.slice(0, 12).toString('latin1')
  if (s.includes('styp') || s.includes('ftyp')) return true
  if (buf[0] === 0x47) return true
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true
  return false
}

/**
 * Testa um título em 4 estágios. Devolve o estágio alcançado.
 * `stage`: 0 = nada, 1 = página, 2 = manifesto, 3 = segmento, 4 = vídeo válido
 */
async function testTitle({ tmdbId, season, episode }) {
  const isEp = season != null && episode != null
  const pageUrl = isEp
    ? `https://v1.watchplay.shop/tvshow/${tmdbId}/${season}/${episode}`
    : `https://v1.watchplay.shop/movie/${tmdbId}`

  const page = await get(pageUrl, 'https://playerflix.ink/')
  if (page.status !== 200) return { stage: 0, reason: `page_${page.status}` }

  const m3u8 = extractM3u8(page.body)
  if (!m3u8) return { stage: 1, reason: 'no_m3u8_in_html' }

  const man = await get(m3u8, 'https://v2.watchplay.shop/')
  if (man.status !== 200 || typeof man.body !== 'string' || !man.body.includes('#EXTM3U')) {
    return { stage: 1, reason: `manifest_${man.status}` }
  }

  const lines = man.body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (!lines.length) return { stage: 2, reason: 'manifest_empty' }

  const segUrl = new URL(lines[0], m3u8).toString()
  const seg = await get(segUrl, 'https://v2.watchplay.shop/', { bin: true })
  if (seg.status !== 200 || !seg.body?.length) return { stage: 2, reason: `segment_${seg.status}` }

  if (!looksLikeVideo(seg.body)) return { stage: 3, reason: 'segment_not_video' }

  return {
    stage: 4,
    reason: 'ok',
    host: new URL(m3u8).hostname,
    segments: lines.length,
    segBytes: seg.body.length,
  }
}

/** Amostra distribuída por TODO o catálogo (passo fixo, não os primeiros N). */
function spread(arr, n) {
  if (arr.length <= n) return arr.slice()
  const step = arr.length / n
  const out = []
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)])
  return out
}

async function pool(items, worker, limit) {
  const results = new Array(items.length)
  let idx = 0
  async function run() {
    while (true) {
      const i = idx++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

function pct(a, b) {
  return b ? ((a / b) * 100).toFixed(1) + '%' : '—'
}

async function main() {
  const filmesRaw = JSON.parse(await fs.readFile('public/filmes/filmes.light.json', 'utf8'))
  const seriesRaw = JSON.parse(await fs.readFile('public/filmes/series.light.json', 'utf8'))
  const filmes = Array.isArray(filmesRaw) ? filmesRaw : Object.values(filmesRaw)[0]
  const series = Array.isArray(seriesRaw) ? seriesRaw : Object.values(seriesRaw)[0]

  console.log(`Catálogo: ${filmes.length} filmes · ${series.length} séries`)
  console.log(`Amostra: ${N_FILMES} filmes · ${N_SERIES} séries · até ${N_EP} episódios cada\n`)

  // ── FILMES ────────────────────────────────────────────────────────────────
  const filmSample = spread(filmes, N_FILMES)
  const filmResults = await pool(
    filmSample,
    async (f) => {
      const id = String(f.tmdb_id || f.id)
      const r = await testTitle({ tmdbId: id })
      return { id, title: f.title, ...r }
    },
    CONCURRENCY,
  )

  // ── SÉRIES ────────────────────────────────────────────────────────────────
  const seriesSample = spread(series, N_SERIES)
  const seriesResults = await pool(
    seriesSample,
    async (s) => {
      const id = String(s.tmdb_id || s.id)
      const eps = Array.isArray(s.episodes_available) ? s.episodes_available : []
      // Testa o primeiro, um do meio e o último episódio disponível.
      const picks = []
      if (eps.length) {
        picks.push(eps[0])
        if (eps.length > 2) picks.push(eps[Math.floor(eps.length / 2)])
        if (eps.length > 1) picks.push(eps[eps.length - 1])
      }
      const uniq = [...new Set(picks)].slice(0, N_EP)
      const epResults = []
      for (const tag of uniq) {
        const [se, ep] = String(tag).split('/').map(Number)
        if (!se || !ep) continue
        const r = await testTitle({ tmdbId: id, season: se, episode: ep })
        epResults.push({ tag, ...r })
      }
      const best = epResults.reduce((a, b) => (b.stage > (a?.stage ?? -1) ? b : a), null)
      return {
        id,
        title: s.title,
        seasons: s.seasons,
        episodes: s.episodes,
        tested: epResults.length,
        working: epResults.filter((e) => e.stage === 4).length,
        stage: best?.stage ?? 0,
        reason: best?.reason ?? 'no_episodes',
        epResults,
      }
    },
    Math.max(2, Math.floor(CONCURRENCY / 2)),
  )

  // ── AGREGADO ──────────────────────────────────────────────────────────────
  const filmOk = filmResults.filter((r) => r.stage === 4)
  const seriesOk = seriesResults.filter((r) => r.stage === 4)
  const epTotal = seriesResults.reduce((a, s) => a + s.tested, 0)
  const epOk = seriesResults.reduce((a, s) => a + s.working, 0)

  console.log('═══ FILMES ═══')
  console.log(`  funcionais (4 estágios): ${filmOk.length}/${filmResults.length} = ${pct(filmOk.length, filmResults.length)}`)
  const filmFail = filmResults.filter((r) => r.stage < 4)
  if (filmFail.length) {
    const byReason = {}
    for (const f of filmFail) byReason[f.reason] = (byReason[f.reason] || 0) + 1
    console.log('  falhas por motivo:', JSON.stringify(byReason))
  }

  console.log('\n═══ SÉRIES ═══')
  console.log(`  séries com ≥1 episódio funcional: ${seriesOk.length}/${seriesResults.length} = ${pct(seriesOk.length, seriesResults.length)}`)
  console.log(`  episódios funcionais: ${epOk}/${epTotal} = ${pct(epOk, epTotal)}`)
  const seriesFail = seriesResults.filter((r) => r.stage < 4)
  if (seriesFail.length) {
    const byReason = {}
    for (const s of seriesFail) byReason[s.reason] = (byReason[s.reason] || 0) + 1
    console.log('  falhas por motivo:', JSON.stringify(byReason))
  }

  console.log('\n═══ AMOSTRAS QUE FALHARAM ═══')
  for (const f of filmFail.slice(0, 8)) console.log(`  filme ${f.id} "${f.title}" → ${f.reason}`)
  for (const s of seriesFail.slice(0, 8)) console.log(`  série ${s.id} "${s.title}" → ${s.reason}`)

  if (JSON_OUT) {
    await fs.writeFile(
      JSON_OUT,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          catalog: { filmes: filmes.length, series: series.length },
          filmes: { sample: filmResults.length, ok: filmOk.length, results: filmResults },
          series: { sample: seriesResults.length, ok: seriesOk.length, epTotal, epOk, results: seriesResults },
        },
        null,
        2,
      ),
    )
    console.log(`\nJSON salvo em ${JSON_OUT}`)
  }
}

main().catch((e) => {
  console.error('FALHOU:', e)
  process.exit(1)
})
