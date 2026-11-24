/**
 * AUDITORIA DE SÉRIES — reprodução REAL, episódio por episódio.
 *
 * ── POR QUE ESTE SCRIPT EXISTE ────────────────────────────────────────────────
 *
 * O `auditar-reproducao.mjs` amostra as séries por PASSO FIXO no catálogo inteiro
 * (8.093 séries). Como só ~24% do catálogo tem fonte no provedor, uma amostra
 * cega mede majoritariamente "sem fonte" e o número final (18,8%) descreve a
 * DISPONIBILIDADE DO PROVEDOR, não a saúde da cadeia de reprodução.
 *
 * Este script separa as duas coisas, que é o que o pedido exige:
 *
 *   • denominador A (catálogo inteiro)  → quantas séries do catálogo tocam
 *   • denominador B (só com fonte)      → das que o provedor diz ter, quantas tocam
 *
 * A meta de 90% só pode ser avaliada em B. Em A o teto é a disponibilidade do
 * provedor (24,3%) e nenhum código muda isso — inventar fonte seria mentir.
 *
 * ── O QUE CONTA COMO REPRODUÇÃO ──────────────────────────────────────────────
 *
 * Quatro estágios, e só o 4º conta:
 *   1 fonte encontrada · 2 manifesto válido · 3 segmento com bytes · 4 bytes de vídeo
 *
 * HTTP 200 nunca conta. Um iframe que existe mas não entrega HLS é
 * `fonte_valida_mas_falhou`, não "funciona".
 *
 * Uso:
 *   node scripts/auditar-series.mjs --series 200 --episodios 3
 *   node scripts/auditar-series.mjs --todas --episodios 2 --concorrencia 8
 *   node scripts/auditar-series.mjs --continuar
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
const flag = (n) => args.includes(`--${n}`)

const N_SERIES = Number(arg('series', 200))
const N_EP = Number(arg('episodios', 3))
const CONCURRENCY = Number(arg('concorrencia', 6))
const TODAS = flag('todas')
const STATE_PATH = arg('state', 'audit/estado-series.json')
const JSON_OUT = arg('json', 'audit/relatorio-series.json')
const CONTINUAR = flag('continuar')

const CLASSE = {
  CONFIRMADA: 'reproducao_confirmada',
  FONTE_VALIDA_FALHOU: 'fonte_valida_mas_falhou',
  FONTE_INVALIDA: 'fonte_invalida',
  INDISPONIVEL: 'fonte_indisponivel',
  ERRO_REDE: 'erro_de_rede',
  CODEC: 'formato_codec_incompativel',
  MANIFESTO: 'erro_manifesto_ou_segmentos',
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
    return { status: 0, err: String(e?.name === 'AbortError' ? 'timeout' : e?.message || e) }
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
    const variant = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
    if (!variant) return { stage: 2, reason: CLASSE.MANIFESTO, detail: 'master_sem_variante' }
    baseUrl = new URL(variant, m3u8).toString()
    const v = await get(baseUrl, referer)
    if (v.status !== 200 || typeof v.body !== 'string' || !v.body.includes('#EXTM3U')) {
      return { stage: 2, reason: CLASSE.MANIFESTO, detail: `variant_${v.status}` }
    }
    text = v.body
  }
  const segs = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
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

/** blogger → MP4 `videoplayback` do CDN do Google. */
async function bloggerStream(embedUrl) {
  let token = null
  try {
    token = new URL(embedUrl).searchParams.get('token')
  } catch {
    return null
  }
  if (!token) return null
  const r = await get(`https://www.blogger.com/video.g?token=${encodeURIComponent(token)}`, 'https://www.blogger.com/')
  if (r.status !== 200) return null
  const html = String(r.body)
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\\x3d/gi, '=')
    .replace(/\\x26/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
  const urls = html.match(/https:\/\/[^"'\s\\]*videoplayback[^"'\s\\]*/g)
  if (!urls || !urls.length) return null
  const pick = urls.find((u) => /[?&]itag=18(&|$)/.test(u)) || urls[0]
  return { url: pick, referer: 'https://www.blogger.com/' }
}

/** mp4 → base64 decodifica para um MP4 direto. */
async function mp4Stream(embedUrl) {
  let b64 = null
  try {
    b64 = new URL(embedUrl).searchParams.get('video_url')
  } catch {
    return null
  }
  if (!b64) return null
  let decoded = null
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf8')
  } catch {
    return null
  }
  if (!/^https:\/\//.test(decoded)) return null
  let target = decoded
  try {
    const inner = new URL(decoded).searchParams.get('u')
    if (inner && /^https:\/\//.test(inner)) target = inner
  } catch {
    /* mantém */
  }
  return { url: target, referer: 'https://playerflix.ink/' }
}

/**
 * Valida um arquivo progressivo (MP4) até o primeiro bloco com bytes de vídeo.
 * Mesmo critério do HLS: só o estágio 4 conta como reprodução.
 */
async function validateProgressive(url, referer) {
  const r = await get(url, referer, { bin: true, headers: { Range: 'bytes=0-2047' } })
  if (r.status === 0) return { stage: 1, reason: CLASSE.ERRO_REDE, detail: r.err }
  if (r.status !== 200 && r.status !== 206) {
    return { stage: 1, reason: CLASSE.MANIFESTO, detail: `file_${r.status}` }
  }
  if (!r.body?.length) return { stage: 2, reason: CLASSE.MANIFESTO, detail: 'empty_body' }
  if (!looksLikeVideo(r.body)) {
    return { stage: 3, reason: CLASSE.CODEC, detail: 'nao_e_video' }
  }
  return {
    stage: 4,
    reason: CLASSE.CONFIRMADA,
    host: new URL(url).hostname,
    segments: 1,
    isMaster: false,
    segBytes: r.body.length,
  }
}

/** Testa UM episódio seguindo a ordem real do servidor. */
async function testEpisode({ tmdbId, season, episode }) {
  const tried = []

  // 1) convenção do watchplay
  const pageUrl = `https://v1.watchplay.shop/tvshow/${tmdbId}/${season}/${episode}`
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

  // 2) opções do Ajax
  const { reachable, options } = await ajaxOptions({ tmdbId, season, episode })
  if (!reachable) tried.push({ layer: 'ajax', stage: 0, reason: CLASSE.ERRO_REDE, detail: 'ajax_inalcancavel' })
  const usable = options.filter((o) => o.budget !== 'danger')
  if (options.length && !usable.length) {
    tried.push({ layer: 'ajax', stage: 0, reason: CLASSE.INDISPONIVEL, detail: 'apenas_plano_pago' })
  }

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

  // 2c) blogger → MP4 direto do CDN do Google (videoplayback)
  for (const o of usable.filter((x) => x.id === 'blogger')) {
    const s = await bloggerStream(o.embed)
    if (!s) {
      tried.push({ layer: 'blogger', stage: 1, reason: CLASSE.FONTE_INVALIDA, detail: 'sem_videoplayback' })
      continue
    }
    const v = await validateProgressive(s.url, s.referer)
    if (v.stage === 4) return { ...v, layer: 'blogger', tried }
    tried.push({ layer: 'blogger', ...v })
  }

  // 2d) mp4 → base64 decodifica para um MP4 direto
  for (const o of usable.filter((x) => x.id === 'mp4')) {
    const s = await mp4Stream(o.embed)
    if (!s) {
      tried.push({ layer: 'mp4', stage: 1, reason: CLASSE.FONTE_INVALIDA, detail: 'sem_mp4' })
      continue
    }
    const v = await validateProgressive(s.url, s.referer)
    if (v.stage === 4) return { ...v, layer: 'mp4', tried }
    tried.push({ layer: 'mp4', ...v })
  }

  const others = usable.filter(
    (x) => !['watchplay', 'embedplayer', 'blogger', 'mp4'].includes(x.id),
  )
  for (const o of others) {
    tried.push({ layer: o.id || 'embed', stage: 1, reason: CLASSE.FONTE_VALIDA_FALHOU, detail: 'somente_iframe' })
  }

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
  const seriesRaw = JSON.parse(await fs.readFile('public/filmes/series.light.json', 'utf8'))
  const series = Array.isArray(seriesRaw) ? seriesRaw : Object.values(seriesRaw)[0]
  const mega = JSON.parse(await fs.readFile('public/filmes/megaembed-disponibilidade.json', 'utf8'))
  const comFonte = new Set((mega.series || []).map(String))

  const elegiveis = series.filter((s) => comFonte.has(String(s.tmdb_id || s.id)))
  const alvo = TODAS ? elegiveis : spread(elegiveis, N_SERIES)

  console.log(`Catálogo: ${series.length} séries · com fonte no provedor: ${elegiveis.length} (${pct(elegiveis.length, series.length)})`)
  console.log(`Auditando: ${alvo.length} séries · até ${N_EP} episódios cada · concorrência ${CONCURRENCY}`)
  console.log(`Estado: ${STATE_PATH} (retomada ${CONTINUAR ? 'ATIVA' : 'inativa'})\n`)

  let done = 0
  const results = await pool(
    alvo,
    async (s) => {
      const id = String(s.tmdb_id || s.id)
      const eps = Array.isArray(s.episodes_available) ? s.episodes_available : []
      const picks = []
      if (eps.length) {
        picks.push(eps[0])
        if (eps.length > 2) picks.push(eps[Math.floor(eps.length / 2)])
        if (eps.length > 1) picks.push(eps[eps.length - 1])
        if (eps.length > 3 && N_EP > 3) picks.push(eps[1])
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
        const r = await testEpisode({ tmdbId: id, season: se, episode: ep })
        epResults.push({ tag, ...r })
        state.done[key] = { stage: r.stage, reason: r.reason, layer: r.layer }
      }
      if (++done % 5 === 0) {
        await saveState(state)
        process.stdout.write(`\r  ${done}/${alvo.length} séries…`)
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
    CONCURRENCY,
  )
  await saveState(state)
  console.log('')

  const allEps = results.flatMap((s) => s.epResults)
  const epOk = allEps.filter((e) => e.stage === 4)
  const seriesOk = results.filter((s) => s.stage === 4)
  const epByLayer = {}
  for (const e of epOk) epByLayer[e.layer] = (epByLayer[e.layer] || 0) + 1
  const failEp = {}
  for (const e of allEps.filter((x) => x.stage < 4)) failEp[e.reason] = (failEp[e.reason] || 0) + 1

  // temporadas com ≥1 ep funcional
  const seasonsMap = new Map()
  for (const s of results) {
    for (const e of s.epResults) {
      const se = String(e.tag).split('/')[0]
      const k = `${s.id}:${se}`
      const cur = seasonsMap.get(k) || { ok: false }
      if (e.stage === 4) cur.ok = true
      seasonsMap.set(k, cur)
    }
  }
  const seasonsTotal = seasonsMap.size
  const seasonsOk = [...seasonsMap.values()].filter((v) => v.ok).length

  console.log('═══════════ SÉRIES (só as com fonte no provedor) ═══════════')
  console.log(`  séries com ≥1 ep funcional : ${seriesOk.length}/${results.length} = ${pct(seriesOk.length, results.length)}`)
  console.log(`  episódios confirmados      : ${epOk.length}/${allEps.length} = ${pct(epOk.length, allEps.length)}`)
  console.log(`  temporadas com ≥1 ep ok    : ${seasonsOk}/${seasonsTotal} = ${pct(seasonsOk, seasonsTotal)}`)
  console.log(`  séries 100% dos testados ok: ${results.filter((s) => s.tested > 0 && s.working === s.tested).length}/${results.length}`)
  console.log(`  por camada                 : ${JSON.stringify(epByLayer)}`)
  console.log(`  motivos de falha           : ${JSON.stringify(failEp)}`)

  const relatorio = {
    at: new Date().toISOString(),
    amostra: { series: alvo.length, episodiosPorSerie: N_EP, todas: TODAS },
    catalogo: { totalSeries: series.length, comFonteNoProvedor: elegiveis.length, percentualComFonte: pct(elegiveis.length, series.length) },
    series: {
      testadas: results.length,
      comEpisodioFuncional: seriesOk.length,
      percentual: pct(seriesOk.length, results.length),
      episodiosTestados: allEps.length,
      episodiosConfirmados: epOk.length,
      percentualEpisodios: pct(epOk.length, allEps.length),
      temporadasTestadas: seasonsTotal,
      temporadasFuncionais: seasonsOk,
      percentualTemporadas: pct(seasonsOk, seasonsTotal),
      seriesCompletas: results.filter((s) => s.tested > 0 && s.working === s.tested).length,
      porCamada: epByLayer,
      falhas: failEp,
      detalhe: results,
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
