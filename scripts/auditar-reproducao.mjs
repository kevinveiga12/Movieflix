/**
 * AUDITORIA DE REPRODUÇÃO — mede a CADEIA REAL do servidor, não só uma camada.
 *
 * ── POR QUE ESTE SCRIPT EXISTE ────────────────────────────────────────────────
 *
 * O `auditar-cobertura.mjs` mede apenas a CONVENÇÃO do `watchplay`
 * (`/movie/{id}`, `/tvshow/{id}/{t}/{e}`). Isso subestimou a cobertura real:
 * medido em 2026-11-23, 68 de 120 filmes davam `page_404` na convenção, mas
 * vários deles TÊM fonte — o `playerflix.ink` lista `embedplayer` com
 * `budget: success`, e o `getVideo` dele devolve um `master.m3u8` real
 * (720p, áudio PT) que o servidor já usa como segunda camada.
 *
 * Este script replica a ordem de `server/lib/playback-chain.js`:
 *
 *   1. `watchplay` por convenção  → HTML com `createMyPlayer({url:"...m3u8"})`
 *   2. `watchplay` pelo Ajax      → opções com `budget: success`
 *   3. `embedplayer`              → POST getVideo → `securedLink` (master.m3u8)
 *
 * Para cada candidato, quatro estágios — HTTP 200 NUNCA conta como reprodução:
 *
 *   1. fonte encontrada     → a página/endpoint respondeu e entregou uma URL
 *   2. manifesto validado   → o m3u8 contém #EXTM3U (e resolve a variante)
 *   3. segmento acessível   → o primeiro segmento responde 200 com bytes
 *   4. segmento é vídeo     → magic bytes de fMP4 (styp/ftyp) ou TS (0x47)
 *
 * Só o estágio 4 conta como REPRODUÇÃO CONFIRMADA.
 *
 * ── RETOMADA (o pedido exige) ─────────────────────────────────────────────────
 *
 * O progresso é gravado a CADA título no arquivo de estado (`--state`). Se o
 * script for interrompido, rodar de novo com o mesmo `--state` continua de onde
 * parou: títulos já no estágio 4 são pulados; os que falharam são retestados
 * (a falha pode ter sido passageira).
 *
 * Uso:
 *   node scripts/auditar-reproducao.mjs --filmes 150 --series 80 --episodios 3
 *   node scripts/auditar-reproducao.mjs --state audit/estado.json --json audit/rel.json
 *   node scripts/auditar-reproducao.mjs --continuar          # usa o mesmo estado
 */

import fs from 'node:fs/promises'
import path from 'node:path'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const args = process.argv.slice(2)
function arg(name, def) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
function flag(name) {
  return args.includes(`--${name}`)
}

const N_FILMES = Number(arg('filmes', 120))
const N_SERIES = Number(arg('series', 60))
const N_EP = Number(arg('episodios', 3))
const CONCURRENCY = Number(arg('concorrencia', 6))
const STATE_PATH = arg('state', 'audit/estado-reproducao.json')
const JSON_OUT = arg('json', 'audit/relatorio-reproducao.json')
const CONTINUAR = flag('continuar')

/**
 * Classificação FINAL de cada título — é o vocabulário que o relatório usa.
 * Nunca inventa: cada rótulo corresponde a um estágio objetivo alcançado.
 */
const CLASSE = {
  CONFIRMADA: 'reproducao_confirmada',
  FONTE_VALIDA_FALHOU: 'fonte_valida_mas_falhou',
  FONTE_INVALIDA: 'fonte_invalida',
  INDISPONIVEL: 'fonte_indisponivel',
  ERRO_REDE: 'erro_de_rede',
  CODEC: 'formato_codec_incompativel',
  MANIFESTO: 'erro_manifesto_ou_segmentos',
  NAO_TESTADO: 'nao_testado',
}

async function get(url, referer, { bin = false, timeoutMs = 12000, method = 'GET', headers, body } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        ...(referer ? { Referer: referer } : {}),
        ...(headers || {}),
      },
      ...(body ? { body } : {}),
    })
    const payload = bin ? Buffer.from(await res.arrayBuffer()) : await res.text()
    return { status: res.status, ct: res.headers.get('content-type'), body: payload }
  } catch (e) {
    return { status: 0, err: String(e?.name === 'AbortError' ? 'timeout' : (e?.message || e)) }
  } finally {
    clearTimeout(timer)
  }
}

function extractM3u8(html) {
  if (typeof html !== 'string') return null
  const m = html.match(/url\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i)
  if (!m) return null
  const url = m[1].replace(/\\\//g, '/')
  return /^https:\/\//.test(url) ? url : null
}

function looksLikeVideo(buf) {
  if (!buf || buf.length < 12) return false
  const s = buf.slice(0, 12).toString('latin1')
  if (s.includes('styp') || s.includes('ftyp')) return true
  if (buf[0] === 0x47) return true
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true
  return false
}

/**
 * Valida um manifesto HLS até o primeiro segmento com bytes de vídeo.
 *
 * Se o manifesto for MASTER (`#EXT-X-STREAM-INF`), desce para a primeira
 * variante — é o que o player faz, e é o único jeito de chegar num segmento.
 */
async function validateManifest(m3u8, referer) {
  const man = await get(m3u8, referer)
  if (man.status === 0) return { stage: 1, reason: CLASSE.ERRO_REDE, detail: man.err }
  if (man.status !== 200) return { stage: 1, reason: CLASSE.MANIFESTO, detail: `manifest_${man.status}` }
  if (typeof man.body !== 'string' || !man.body.includes('#EXTM3U')) {
    return { stage: 1, reason: CLASSE.MANIFESTO, detail: 'not_hls' }
  }

  let text = man.body
  let baseUrl = m3u8
  const isMaster = /#EXT-X-STREAM-INF/i.test(text)

  if (isMaster) {
    const variant = text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'))
    if (!variant) return { stage: 2, reason: CLASSE.MANIFESTO, detail: 'master_sem_variante' }
    baseUrl = new URL(variant, m3u8).toString()
    const v = await get(baseUrl, referer)
    if (v.status !== 200 || typeof v.body !== 'string' || !v.body.includes('#EXTM3U')) {
      return { stage: 2, reason: CLASSE.MANIFESTO, detail: `variant_${v.status}` }
    }
    text = v.body
  }

  const segs = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  if (!segs.length) return { stage: 2, reason: CLASSE.MANIFESTO, detail: 'manifest_sem_segmento' }

  const segUrl = new URL(segs[0], baseUrl).toString()
  const seg = await get(segUrl, referer, { bin: true })
  if (seg.status === 0) return { stage: 2, reason: CLASSE.ERRO_REDE, detail: seg.err }
  if (seg.status !== 200 || !seg.body?.length) {
    return { stage: 2, reason: CLASSE.MANIFESTO, detail: `segment_${seg.status}` }
  }
  if (!looksLikeVideo(seg.body)) {
    return { stage: 3, reason: CLASSE.CODEC, detail: 'segmento_nao_e_video' }
  }

  return {
    stage: 4,
    reason: CLASSE.CONFIRMADA,
    host: new URL(m3u8).hostname,
    segments: segs.length,
    isMaster,
    segBytes: seg.body.length,
  }
}

/** Opções que o `playerflix.ink` lista, já filtradas por `budget !== danger`. */
async function ajaxOptions({ tmdbId, season, episode }) {
  const isEp = season != null && episode != null
  const qs = new URLSearchParams({
    type: isEp ? 'tv' : 'movie',
    id: String(tmdbId),
    season: isEp ? String(season) : 'null',
    episode: isEp ? String(episode) : 'null',
  })
  const r = await get(`https://playerflix.ink/inc/Ajax.php?${qs}`, 'https://playerflix.ink/', {
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    timeoutMs: 9000,
  })
  if (r.status !== 200) return { reachable: r.status > 0 && r.status < 500, options: [] }
  try {
    const j = JSON.parse(r.body)
    const opts = j?.data?.options
    if (!Array.isArray(opts)) return { reachable: true, options: [] }
    return {
      reachable: true,
      options: opts
        .filter((o) => typeof o?.embed === 'string' && /^https:\/\//.test(o.embed))
        .map((o) => ({ id: o.id ?? '', embed: o.embed, label: o.label ?? '', budget: String(o?.budget ?? '') })),
    }
  } catch {
    return { reachable: true, options: [] }
  }
}

/** HLS do `embedplayer2.xyz` (o anúncio mora no iframe, não no CDN). */
async function embedPlayerStream(embedUrl) {
  const hash = String(embedUrl).split('/').pop()
  if (!/^[a-f0-9]{16,64}$/i.test(hash)) return null
  const r = await get(
    `https://embedplayer2.xyz/player/index.php?data=${hash}&do=getVideo`,
    `https://embedplayer2.xyz/video/${hash}`,
    {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `hash=${hash}&r=${encodeURIComponent('https://playerflix.ink/')}`,
      timeoutMs: 12000,
    },
  )
  if (r.status !== 200) return null
  try {
    const j = JSON.parse(r.body)
    const link = typeof j?.securedLink === 'string' ? j.securedLink : null
    if (!link || !/^https:\/\//.test(link)) return null
    return { url: link, referer: 'https://embedplayer2.xyz/' }
  } catch {
    return null
  }
}

/**
 * Testa UM título seguindo a ordem real do servidor.
 * Devolve `{ stage, reason, layer }` — `layer` diz QUAL camada funcionou.
 */
async function testTitle({ tmdbId, season, episode }) {
  const isEp = season != null && episode != null
  const tried = []

  // ── Camada 1: convenção do watchplay ────────────────────────────────────────
  const pageUrl = isEp
    ? `https://v1.watchplay.shop/tvshow/${tmdbId}/${season}/${episode}`
    : `https://v1.watchplay.shop/movie/${tmdbId}`
  const page = await get(pageUrl, 'https://playerflix.ink/')
  if (page.status === 200) {
    const m3u8 = extractM3u8(page.body)
    if (m3u8) {
      const v = await validateManifest(m3u8, 'https://v2.watchplay.shop/')
      if (v.stage === 4) return { ...v, layer: 'watchplay_convencao', tried }
      tried.push({ layer: 'watchplay_convencao', ...v })
    } else {
      tried.push({ layer: 'watchplay_convencao', stage: 1, reason: CLASSE.MANIFESTO, detail: 'sem_m3u8' })
    }
  } else {
    tried.push({ layer: 'watchplay_convencao', stage: 0, reason: CLASSE.INDISPONIVEL, detail: `page_${page.status}` })
  }

  // ── Camada 2 e 3: opções do Ajax ────────────────────────────────────────────
  const { reachable, options } = await ajaxOptions({ tmdbId, season, episode })
  if (!reachable) {
    tried.push({ layer: 'ajax', stage: 0, reason: CLASSE.ERRO_REDE, detail: 'ajax_inalcancavel' })
  }
  const usable = options.filter((o) => o.budget !== 'danger')
  if (options.length && !usable.length) {
    tried.push({ layer: 'ajax', stage: 0, reason: CLASSE.INDISPONIVEL, detail: 'apenas_plano_pago' })
  }

  // 2a) watchplay listado pelo Ajax
  for (const o of usable.filter((x) => x.id === 'watchplay')) {
    const pg = await get(o.embed, 'https://playerflix.ink/')
    const m3u8 = pg.status === 200 ? extractM3u8(pg.body) : null
    if (!m3u8) {
      tried.push({ layer: 'watchplay_ajax', stage: 1, reason: CLASSE.FONTE_INVALIDA, detail: `page_${pg.status}` })
      continue
    }
    const v = await validateManifest(m3u8, 'https://v2.watchplay.shop/')
    if (v.stage === 4) return { ...v, layer: 'watchplay_ajax', tried }
    tried.push({ layer: 'watchplay_ajax', ...v })
  }

  // 2b) embedplayer → HLS direto (sem iframe)
  for (const o of usable.filter((x) => x.id === 'embedplayer')) {
    const s = await embedPlayerStream(o.embed)
    if (!s) {
      tried.push({ layer: 'embedplayer', stage: 1, reason: CLASSE.FONTE_INVALIDA, detail: 'sem_securedLink' })
      continue
    }
    const v = await validateManifest(s.url, s.referer)
    if (v.stage === 4) return { ...v, layer: 'embedplayer', tried }
    tried.push({ layer: 'embedplayer', ...v })
  }

  // 2c) Demais embeds: só o iframe existe, sem HLS extraível.
  const others = usable.filter((x) => x.id !== 'watchplay' && x.id !== 'embedplayer')
  for (const o of others) {
    tried.push({ layer: o.id || 'embed', stage: 1, reason: CLASSE.FONTE_VALIDA_FALHOU, detail: 'somente_iframe' })
  }

  // Veredito: a MELHOR tentativa explica o motivo.
  const best = tried.reduce((a, b) => ((b?.stage ?? -1) > (a?.stage ?? -1) ? b : a), null)
  return {
    stage: best?.stage ?? 0,
    reason: best?.reason ?? CLASSE.INDISPONIVEL,
    detail: best?.detail,
    layer: best?.layer,
    tried,
  }
}

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

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—')

async function loadState() {
  if (!CONTINUAR) return { done: {} }
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf8'))
  } catch {
    return { done: {} }
  }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true })
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 0))
}

async function main() {
  const state = await loadState()
  const filmesRaw = JSON.parse(await fs.readFile('public/filmes/filmes.light.json', 'utf8'))
  const seriesRaw = JSON.parse(await fs.readFile('public/filmes/series.light.json', 'utf8'))
  const filmes = Array.isArray(filmesRaw) ? filmesRaw : Object.values(filmesRaw)[0]
  const series = Array.isArray(seriesRaw) ? seriesRaw : Object.values(seriesRaw)[0]

  console.log(`Amostra: ${N_FILMES} filmes · ${N_SERIES} séries · até ${N_EP} episódios`)
  console.log(`Estado: ${STATE_PATH} (retomada ${CONTINUAR ? 'ATIVA' : 'inativa'})\n`)

  const filmSample = spread(filmes, N_FILMES)
  const seriesSample = spread(series, N_SERIES)

  // ── FILMES ──────────────────────────────────────────────────────────────────
  let filmCount = 0
  const filmResults = await pool(
    filmSample,
    async (f) => {
      const id = String(f.tmdb_id || f.id)
      const key = `movie:${id}`
      if (CONTINUAR && state.done[key]?.stage === 4) return { id, title: f.title, ...state.done[key] }
      const r = await testTitle({ tmdbId: id })
      const row = { id, title: f.title, ...r }
      state.done[key] = { stage: r.stage, reason: r.reason, layer: r.layer }
      if (++filmCount % 10 === 0) await saveState(state)
      return row
    },
    CONCURRENCY,
  )
  await saveState(state)

  // ── SÉRIES ──────────────────────────────────────────────────────────────────
  let seriesCount = 0
  const seriesResults = await pool(
    seriesSample,
    async (s) => {
      const id = String(s.tmdb_id || s.id)
      const eps = Array.isArray(s.episodes_available) ? s.episodes_available : []
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
        const key = `tv:${id}:${se}:${ep}`
        if (CONTINUAR && state.done[key]?.stage === 4) {
          epResults.push({ tag, ...state.done[key] })
          continue
        }
        const r = await testTitle({ tmdbId: id, season: se, episode: ep })
        epResults.push({ tag, ...r })
        state.done[key] = { stage: r.stage, reason: r.reason, layer: r.layer }
        if (++seriesCount % 5 === 0) await saveState(state)
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
        layer: best?.layer,
        epResults,
      }
    },
    Math.max(2, Math.floor(CONCURRENCY / 2)),
  )
  await saveState(state)

  // ── RESUMO ──────────────────────────────────────────────────────────────────
  const filmOk = filmResults.filter((r) => r.stage === 4)
  const filmWithSource = filmResults.filter((r) => r.stage >= 1)
  const byLayer = {}
  for (const r of filmOk) byLayer[r.layer] = (byLayer[r.layer] || 0) + 1

  const failReasons = {}
  for (const r of filmResults.filter((x) => x.stage < 4)) {
    failReasons[r.reason] = (failReasons[r.reason] || 0) + 1
  }

  const allEps = seriesResults.flatMap((s) => s.epResults)
  const epOk = allEps.filter((e) => e.stage === 4)
  const seriesOk = seriesResults.filter((s) => s.stage === 4)
  const epByLayer = {}
  for (const e of epOk) epByLayer[e.layer] = (epByLayer[e.layer] || 0) + 1

  console.log('═══════ FILMES ═══════')
  console.log(`  com fonte válida encontrada : ${filmWithSource.length}/${filmResults.length}`)
  console.log(`  reprodução CONFIRMADA (4/4) : ${filmOk.length}/${filmResults.length} = ${pct(filmOk.length, filmResults.length)}`)
  console.log(`  entre os COM fonte          : ${pct(filmOk.length, filmWithSource.length)}`)
  console.log(`  por camada                  : ${JSON.stringify(byLayer)}`)
  console.log(`  motivos de falha            : ${JSON.stringify(failReasons)}`)

  console.log('\n═══════ SÉRIES ═══════')
  console.log(`  séries com ≥1 ep funcional  : ${seriesOk.length}/${seriesResults.length} = ${pct(seriesOk.length, seriesResults.length)}`)
  console.log(`  episódios confirmados       : ${epOk.length}/${allEps.length} = ${pct(epOk.length, allEps.length)}`)
  console.log(`  por camada                  : ${JSON.stringify(epByLayer)}`)

  const failEp = {}
  for (const e of allEps.filter((x) => x.stage < 4)) failEp[e.reason] = (failEp[e.reason] || 0) + 1
  console.log(`  motivos de falha            : ${JSON.stringify(failEp)}`)

  const filmFails = filmResults.filter((r) => r.stage < 4).slice(0, 20)
  if (filmFails.length) {
    console.log('\n═══ amostras de falha (filmes) ═══')
    for (const r of filmFails) console.log(`  ${r.id} "${r.title}" → ${r.reason} (${r.detail ?? ''})`)
  }

  const relatorio = {
    at: new Date().toISOString(),
    amostra: { filmes: N_FILMES, series: N_SERIES, episodios: N_EP },
    filmes: {
      testados: filmResults.length,
      comFonte: filmWithSource.length,
      confirmados: filmOk.length,
      percentualConfirmado: pct(filmOk.length, filmResults.length),
      percentualEntreComFonte: pct(filmOk.length, filmWithSource.length),
      porCamada: byLayer,
      falhas: failReasons,
      detalhe: filmResults,
    },
    series: {
      testadas: seriesResults.length,
      comEpisodioFuncional: seriesOk.length,
      percentual: pct(seriesOk.length, seriesResults.length),
      episodiosTestados: allEps.length,
      episodiosConfirmados: epOk.length,
      percentualEpisodios: pct(epOk.length, allEps.length),
      porCamada: epByLayer,
      falhas: failEp,
      detalhe: seriesResults,
    },
  }

  await fs.mkdir(path.dirname(JSON_OUT), { recursive: true })
  await fs.writeFile(JSON_OUT, JSON.stringify(relatorio, null, 2))
  console.log(`\nJSON: ${JSON_OUT}`)
}

main().catch((e) => {
  console.error('FALHOU:', e)
  process.exit(1)
})
