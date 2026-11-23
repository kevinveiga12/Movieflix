/**
 * MEDIÇÃO DE SÉRIES — consulta como EPISÓDIO (type=tv), não como filme.
 *
 * A primeira medição passou season/episode nulos, então o Ajax respondeu no
 * ramo de FILME e os números de série saíram inválidos. Aqui cada série é
 * consultada com T1E1 (e, quando falha, T1E2) — é o caminho real do player.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const AJAX = 'https://playerflix.ink/inc/Ajax.php'

async function fetchOptions(tmdbId, season, episode) {
  const qs = new URLSearchParams({
    type: 'tv',
    id: String(tmdbId),
    season: String(season),
    episode: String(episode),
  })
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${AJAX}?${qs}`, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Referer: 'https://playerflix.ink/',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
    })
    if (!res.ok) return null
    const j = await res.json()
    return Array.isArray(j?.data?.options) ? j.data.options : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function extractM3u8(embedUrl) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 9000)
  try {
    const res = await fetch(embedUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Referer: 'https://playerflix.ink/', Accept: 'text/html' },
    })
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/url\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i)
    return m ? m[1].replace(/\\\//g, '/') : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const PUBLIC = path.join(process.cwd(), 'public', 'filmes')

async function main() {
  const n = Number(process.argv[2] ?? 30)
  const list = JSON.parse(await fs.readFile(path.join(PUBLIC, 'series.light.json'), 'utf8'))
  const step = Math.max(1, Math.floor(list.length / n))
  const items = []
  for (let i = 0; i < list.length && items.length < n; i += step) items.push(list[i])

  const stats = { total: items.length, hls: 0, embedOnly: 0, dangerOnly: 0, none: 0, byProvider: {} }
  const details = []

  for (const t of items) {
    const id = t.tmdb_id ?? t.id
    let opts = await fetchOptions(id, 1, 1)
    let used = '1/1'
    if (opts && !opts.some((o) => String(o.budget) !== 'danger')) {
      const alt = await fetchOptions(id, 1, 2)
      if (alt && alt.some((o) => String(o.budget) !== 'danger')) {
        opts = alt
        used = '1/2'
      }
    }
    if (opts === null) {
      stats.none++
      details.push({ id, title: t.title, result: 'ajax_fail' })
      continue
    }
    const usable = opts.filter((o) => String(o.budget) !== 'danger')
    if (!usable.length) {
      stats.dangerOnly++
      details.push({ id, title: t.title, result: 'danger_only', opts: opts.map((o) => o.id) })
      continue
    }
    const wp = usable.find((o) => o.id === 'watchplay')
    let m3u8 = null
    if (wp) m3u8 = await extractM3u8(wp.embed)
    if (m3u8) {
      stats.hls++
      details.push({ id, title: t.title, result: 'hls', ep: used, url: m3u8.slice(0, 70) })
    } else {
      stats.embedOnly++
      details.push({ id, title: t.title, result: 'embed_only', ep: used, opts: usable.map((o) => o.id) })
    }
    for (const o of opts) stats.byProvider[o.id] = (stats.byProvider[o.id] ?? 0) + 1
  }

  console.log(`\n=== SÉRIES (${stats.total} amostradas, consulta T1E1/T1E2) ===`)
  console.log(`  HLS limpo:   ${stats.hls}`)
  console.log(`  só embed:    ${stats.embedOnly}`)
  console.log(`  só danger:   ${stats.dangerOnly}`)
  console.log(`  sem opção:   ${stats.none}`)
  console.log(`  por provedor: ${JSON.stringify(stats.byProvider)}`)
  console.log('\nDetalhes:')
  for (const d of details) console.log(' ', JSON.stringify(d))
  await fs.writeFile('/tmp/cobertura-series.json', JSON.stringify({ stats, details }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
