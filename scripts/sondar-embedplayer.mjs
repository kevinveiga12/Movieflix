/**
 * SONDAGEM DO `embedplayer` COMO FONTE DE HLS DIRETO.
 *
 * ── POR QUE ESTE SCRIPT EXISTE ──────────────────────────────────────────────
 *
 * O `embedplayer2.xyz` era tratado como "embed com anúncio" e ficava desligado.
 * Mas ele tem um endpoint que devolve o HLS cru:
 *
 *     POST /player/index.php?data={hash}&do=getVideo
 *     body: hash={hash}&r={referer}
 *     → { hls: true, securedLink: "https://.../master.m3u8?md5=...&expires=..." }
 *
 * Se esse m3u8 tocar no NOSSO <video>, o anúncio do iframe nunca carrega —
 * o iframe é que tem os trackers, não o CDN do vídeo. Ou seja: dá para usar a
 * FONTE dele sem usar o PLAYER dele.
 *
 * Este script mede exatamente isso, em 4 estágios, e NÃO conta HTTP 200 como
 * sucesso:
 *
 *   1. Ajax listou a opção com budget=success
 *   2. getVideo devolveu securedLink
 *   3. master.m3u8 respondeu #EXTM3U
 *   4. variante → primeiro segmento com magic bytes de vídeo
 *
 * Uso:
 *   node scripts/sondar-embedplayer.mjs --filmes 40 --series 30
 */

import fs from 'node:fs/promises'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const args = process.argv.slice(2)
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const N_FILMES = Number(arg('filmes', 40))
const N_SERIES = Number(arg('series', 30))
const CONC = Number(arg('concorrencia', 5))
const OUT = arg('json', null)

async function get(url, referer, { bin = false, timeoutMs = 15000, xhr = false } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Referer: referer,
        Accept: '*/*',
        // O Ajax do playerflix exige este header: sem ele responde vazio.
        ...(xhr ? { 'X-Requested-With': 'XMLHttpRequest' } : {}),
      },
    })
    const body = bin ? Buffer.from(await res.arrayBuffer()) : await res.text()
    return { status: res.status, ct: res.headers.get('content-type'), body }
  } catch (e) {
    return { status: 0, err: String(e?.message || e) }
  } finally {
    clearTimeout(t)
  }
}

async function ajax({ tmdbId, season, episode }) {
  const isEp = season != null && episode != null
  const qs = new URLSearchParams({
    type: isEp ? 'tv' : 'movie',
    id: String(tmdbId),
    season: isEp ? String(season) : 'null',
    episode: isEp ? String(episode) : 'null',
  })
  const r = await get(`https://playerflix.ink/inc/Ajax.php?${qs}`, 'https://playerflix.ink/', { xhr: true })
  if (r.status !== 200) return []
  try {
    const j = JSON.parse(r.body)
    return Array.isArray(j?.data?.options) ? j.data.options : []
  } catch {
    return []
  }
}

/** POST getVideo → securedLink. */
async function getVideo(hash) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(`https://embedplayer2.xyz/player/index.php?data=${hash}&do=getVideo`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Referer: `https://embedplayer2.xyz/video/${hash}`,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `hash=${hash}&r=${encodeURIComponent('https://playerflix.ink/')}`,
    })
    if (!res.ok) return null
    const j = await res.json()
    return typeof j?.securedLink === 'string' ? j.securedLink : null
  } catch {
    return null
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
 * Valida o HLS do embedplayer até o segmento.
 *
 * O master aponta variantes com caminho ABSOLUTO a partir da RAIZ do host
 * (`/hls/...`), não relativo a `/cdn/hls/`. Resolver com `new URL(v, master)`
 * daria `/cdn/hls/hls/...` e 404 — foi medido. Por isso a base é a origem.
 */
async function validateHls(masterUrl) {
  const man = await get(masterUrl, 'https://embedplayer2.xyz/')
  if (man.status !== 200 || typeof man.body !== 'string' || !man.body.includes('#EXTM3U')) {
    return { stage: 2, reason: `master_${man.status}` }
  }
  const origin = new URL(masterUrl).origin
  const lines = man.body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

  // Master (variantes) ou playlist direta?
  let segLines = lines
  let variantUrl = null
  if (lines.length && /\.m3u8|^\/hls\//i.test(lines[0])) {
    variantUrl = lines[0].startsWith('http') ? lines[0] : origin + lines[0]
    const v = await get(variantUrl, 'https://embedplayer2.xyz/')
    if (v.status !== 200 || typeof v.body !== 'string' || !v.body.includes('#EXTM3U')) {
      return { stage: 2, reason: `variant_${v.status}` }
    }
    segLines = v.body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  }
  if (!segLines.length) return { stage: 2, reason: 'no_segments' }

  const segUrl = segLines[0].startsWith('http')
    ? segLines[0]
    : new URL(segLines[0], variantUrl || masterUrl).toString()
  const seg = await get(segUrl, 'https://embedplayer2.xyz/', { bin: true })
  if (seg.status !== 200 || !seg.body?.length) return { stage: 2, reason: `segment_${seg.status}` }
  if (!looksLikeVideo(seg.body)) return { stage: 3, reason: 'segment_not_video' }

  return { stage: 4, reason: 'ok', segBytes: seg.body.length, segments: segLines.length }
}

async function testTitle({ tmdbId, season, episode }) {
  const opts = await ajax({ tmdbId, season, episode })
  if (!opts.length) return { stage: 0, reason: 'ajax_empty' }

  const ep = opts.find((o) => o.id === 'embedplayer' && o.budget !== 'danger')
  if (!ep) {
    const hasWp = opts.some((o) => o.id === 'watchplay' && o.budget !== 'danger')
    return { stage: 0, reason: hasWp ? 'watchplay_only' : 'no_embedplayer' }
  }

  const hash = ep.embed_id || String(ep.embed || '').split('/').pop()
  if (!hash) return { stage: 1, reason: 'no_hash' }

  const link = await getVideo(hash)
  if (!link) return { stage: 1, reason: 'getvideo_null' }

  const v = await validateHls(link)
  return { ...v, hash }
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
  console.log(`Amostra: ${N_FILMES} filmes · ${N_SERIES} séries\n`)

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
      }
      const uniq = [...new Set(picks)].slice(0, 2)
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
      }
    },
    Math.max(2, Math.floor(CONC / 2)),
  )

  const fOk = fRes.filter((r) => r.stage === 4)
  const sOk = sRes.filter((r) => r.stage === 4)
  const epTotal = sRes.reduce((a, s) => a + s.tested, 0)
  const epOk = sRes.reduce((a, s) => a + s.working, 0)

  console.log('═══ FILMES (embedplayer → HLS direto) ═══')
  console.log(`  funcionais: ${fOk.length}/${fRes.length} = ${pct(fOk.length, fRes.length)}`)
  const fBy = {}
  for (const r of fRes.filter((x) => x.stage < 4)) fBy[r.reason] = (fBy[r.reason] || 0) + 1
  console.log('  motivos:', JSON.stringify(fBy))

  console.log('\n═══ SÉRIES (embedplayer → HLS direto) ═══')
  console.log(`  séries com ≥1 ep funcional: ${sOk.length}/${sRes.length} = ${pct(sOk.length, sRes.length)}`)
  console.log(`  episódios funcionais: ${epOk}/${epTotal} = ${pct(epOk, epTotal)}`)
  const sBy = {}
  for (const r of sRes.filter((x) => x.stage < 4)) sBy[r.reason] = (sBy[r.reason] || 0) + 1
  console.log('  motivos:', JSON.stringify(sBy))

  if (OUT) {
    await fs.writeFile(
      OUT,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          filmes: { sample: fRes.length, ok: fOk.length, results: fRes },
          series: { sample: sRes.length, ok: sOk.length, epTotal, epOk, results: sRes },
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
