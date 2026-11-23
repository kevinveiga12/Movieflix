/**
 * COBERTURA COMBINADA — mede a CADEIA REAL, não um provedor isolado.
 *
 * Diferente de `auditar-cobertura.mjs` (que só testa a convenção do watchplay)
 * e de `sondar-embedplayer.mjs` (que só testa o embedplayer), este script
 * chama `resolvePlaybackChain` — exatamente o que a produção chama quando o
 * cliente clica em ASSISTIR — e depois valida o m3u8 até o segmento.
 *
 * Estágios (não conta HTTP 200 como sucesso):
 *   1. cadeia devolveu ≥1 fonte
 *   2. o m3u8 da fonte respondeu #EXTM3U
 *   3. o primeiro segmento respondeu 200 com bytes
 *   4. o segmento tem magic bytes de vídeo
 *
 * Uso:
 *   node scripts/medir-cadeia.mjs --filmes 60 --series 40 --episodios 2
 */
import fs from 'node:fs/promises'
import { resolvePlaybackChain } from '../server/lib/playback-chain.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const args = process.argv.slice(2)
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const N_FILMES = Number(arg('filmes', 60))
const N_SERIES = Number(arg('series', 40))
const N_EP = Number(arg('episodios', 2))
const CONC = Number(arg('concorrencia', 5))
const OUT = arg('json', null)

async function get(url, referer, { bin = false, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
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
    clearTimeout(t)
  }
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
 * Valida uma fonte da cadeia até o segmento.
 *
 * A fonte `direct` já vem como `/api/stream.m3u8?u=...&r=...` — o proxy da
 * produção. Aqui chamamos o CDN direto (o proxy só reescreve URIs), porque o
 * objetivo é medir o VÍDEO, não o nosso próprio HTTP.
 */
async function validateSource(src) {
  let m3u8Url = src.url
  let referer = 'https://v2.watchplay.shop/'
  if (src.url.startsWith('/api/stream')) {
    const q = new URL(src.url, 'https://x.local').searchParams
    m3u8Url = q.get('u')
    referer = q.get('r') || referer
  }
  if (!m3u8Url) return { stage: 1, reason: 'no_url' }

  const man = await get(m3u8Url, referer)
  if (man.status !== 200 || typeof man.body !== 'string' || !man.body.includes('#EXTM3U')) {
    return { stage: 1, reason: `manifest_${man.status}` }
  }

  const origin = new URL(m3u8Url).origin
  let lines = man.body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  let base = m3u8Url

  // Master → desce para a primeira variante.
  if (lines.length && /\.m3u8|^\/hls\//i.test(lines[0])) {
    const vUrl = lines[0].startsWith('http') ? lines[0] : origin + lines[0]
    const v = await get(vUrl, referer)
    if (v.status !== 200 || typeof v.body !== 'string' || !v.body.includes('#EXTM3U')) {
      return { stage: 2, reason: `variant_${v.status}` }
    }
    lines = v.body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    base = vUrl
  }
  if (!lines.length) return { stage: 2, reason: 'no_segments' }

  const segUrl = lines[0].startsWith('http') ? lines[0] : new URL(lines[0], base).toString()
  const seg = await get(segUrl, referer, { bin: true })
  if (seg.status !== 200 || !seg.body?.length) return { stage: 2, reason: `segment_${seg.status}` }
  if (!looksLikeVideo(seg.body)) return { stage: 3, reason: 'segment_not_video' }

  return { stage: 4, reason: 'ok', segBytes: seg.body.length, provider: src.provider }
}

async function testTitle({ tmdbId, season, episode }) {
  const chain = await resolvePlaybackChain({ tmdbId, season, episode })
  if (!chain.length) return { stage: 0, reason: 'no_source', providers: [] }
  const providers = chain.map((s) => s.provider)
  const v = await validateSource(chain[0])
  // `validateSource` devolve o provider da FONTE; o fallback cobre o caso em
  // que ele não veio (fonte sem `provider`), para não contar como "desconhecido".
  return { ...v, provider: v.provider || providers[0], providers }
}

function spread(arr, n) {
  if (arr.length <= n) return arr.slice()
  const step = arr.length / n
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)])
}

async function pool(items, worker, limit) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const k = i++
        if (k >= items.length) return
        out[k] = await worker(items[k], k)
      }
    }),
  )
  return out
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—')

async function main() {
  const fRaw = JSON.parse(await fs.readFile('public/filmes/filmes.light.json', 'utf8'))
  const sRaw = JSON.parse(await fs.readFile('public/filmes/series.light.json', 'utf8'))
  const filmes = Array.isArray(fRaw) ? fRaw : Object.values(fRaw)[0]
  const series = Array.isArray(sRaw) ? sRaw : Object.values(sRaw)[0]

  console.log(`Catálogo: ${filmes.length} filmes · ${series.length} séries`)
  console.log(`Amostra: ${N_FILMES} filmes · ${N_SERIES} séries · até ${N_EP} eps\n`)

  const fRes = await pool(
    spread(filmes, N_FILMES),
    async (f) => {
      const id = String(f.tmdb_id || f.id)
      return { id, title: f.title, ...(await testTitle({ tmdbId: id })) }
    },
    CONC,
  )

  const sRes = await pool(
    spread(series, N_SERIES),
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
      const epRes = []
      for (const tag of uniq) {
        const [se, ep] = String(tag).split('/').map(Number)
        if (!se || !ep) continue
        epRes.push({ tag, ...(await testTitle({ tmdbId: id, season: se, episode: ep })) })
      }
      const best = epRes.reduce((a, b) => (b.stage > (a?.stage ?? -1) ? b : a), null)
      return {
        id,
        title: s.title,
        tested: epRes.length,
        working: epRes.filter((e) => e.stage === 4).length,
        stage: best?.stage ?? 0,
        reason: best?.reason ?? 'no_episodes',
        providers: best?.providers ?? [],
      }
    },
    Math.max(2, Math.floor(CONC / 2)),
  )

  const fOk = fRes.filter((r) => r.stage === 4)
  const sOk = sRes.filter((r) => r.stage === 4)
  const epTotal = sRes.reduce((a, s) => a + s.tested, 0)
  const epOk = sRes.reduce((a, s) => a + s.working, 0)

  const byProvider = {}
  for (const r of [...fOk, ...sOk]) {
    const p = r.provider || 'desconhecido'
    byProvider[p] = (byProvider[p] || 0) + 1
  }

  console.log('═══ FILMES ═══')
  console.log(`  funcionais: ${fOk.length}/${fRes.length} = ${pct(fOk.length, fRes.length)}`)
  const fBy = {}
  for (const r of fRes.filter((x) => x.stage < 4)) fBy[r.reason] = (fBy[r.reason] || 0) + 1
  console.log('  motivos:', JSON.stringify(fBy))

  console.log('\n═══ SÉRIES ═══')
  console.log(`  séries com ≥1 ep funcional: ${sOk.length}/${sRes.length} = ${pct(sOk.length, sRes.length)}`)
  console.log(`  episódios funcionais: ${epOk}/${epTotal} = ${pct(epOk, epTotal)}`)
  const sBy = {}
  for (const r of sRes.filter((x) => x.stage < 4)) sBy[r.reason] = (sBy[r.reason] || 0) + 1
  console.log('  motivos:', JSON.stringify(sBy))

  console.log('\n═══ POR PROVEDOR (só os que reproduziram) ═══')
  console.log(' ', JSON.stringify(byProvider))

  if (OUT) {
    await fs.writeFile(
      OUT,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          filmes: { sample: fRes.length, ok: fOk.length, results: fRes },
          series: { sample: sRes.length, ok: sOk.length, epTotal, epOk, results: sRes },
          byProvider,
        },
        null,
        2,
      ),
    )
    console.log(`\nJSON: ${OUT}`)
  }
}

main().catch((e) => {
  console.error('FALHOU:', e)
  process.exit(1)
})
