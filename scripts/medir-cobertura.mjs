/**
 * MEDIÇÃO DE COBERTURA DOS PROVEDORES — amostra real do catálogo.
 *
 * Para cada título da amostra, pergunta ao `playerflix.ink` quais opções ele
 * oferece e classifica cada uma:
 *
 *   hls      → a opção entrega um m3u8 tocável (o melhor caso: player nosso)
 *   embed    → a opção é um iframe de player (pode ter anúncio)
 *   danger   → o provedor marca como plano pago (não reproduz)
 *   none     → nenhuma opção
 *
 * Não inventa nada: só conta o que o provedor respondeu.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const AJAX = 'https://playerflix.ink/inc/Ajax.php'

async function fetchOptions(tmdbId, season, episode) {
  const isEp = season != null && episode != null
  const qs = new URLSearchParams({
    type: isEp ? 'tv' : 'movie',
    id: String(tmdbId),
    season: isEp ? String(season) : 'null',
    episode: isEp ? String(episode) : 'null',
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

async function sample(kind, n) {
  const file = kind === 'movie' ? 'filmes.light.json' : 'series.light.json'
  const list = JSON.parse(await fs.readFile(path.join(PUBLIC, file), 'utf8'))
  // Amostra determinística: passo fixo pela lista inteira (não só o topo).
  const step = Math.max(1, Math.floor(list.length / n))
  const out = []
  for (let i = 0; i < list.length && out.length < n; i += step) out.push(list[i])
  return out
}

async function main() {
  const n = Number(process.argv[2] ?? 40)
  const report = { movies: {}, series: {} }

  for (const kind of ['movie', 'tv']) {
    const items = await sample(kind, n)
    const stats = { total: items.length, hls: 0, embedOnly: 0, dangerOnly: 0, none: 0, byProvider: {} }
    const details = []

    for (const t of items) {
      const id = t.tmdb_id ?? t.id
      const opts = await fetchOptions(id, null, null)
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
      // Tenta extrair m3u8 da primeira opção watchplay.
      const wp = usable.find((o) => o.id === 'watchplay')
      let m3u8 = null
      if (wp) m3u8 = await extractM3u8(wp.embed)
      if (m3u8) {
        stats.hls++
        details.push({ id, title: t.title, result: 'hls', url: m3u8.slice(0, 80) })
      } else {
        stats.embedOnly++
        details.push({ id, title: t.title, result: 'embed_only', opts: usable.map((o) => o.id) })
      }
      for (const o of opts) {
        stats.byProvider[o.id] = (stats.byProvider[o.id] ?? 0) + 1
      }
    }

    report[kind === 'movie' ? 'movies' : 'series'] = { stats, details }
    console.log(`\n=== ${kind.toUpperCase()} (${stats.total} amostrados) ===`)
    console.log(`  HLS limpo:   ${stats.hls}`)
    console.log(`  só embed:    ${stats.embedOnly}`)
    console.log(`  só danger:   ${stats.dangerOnly}`)
    console.log(`  sem opção:   ${stats.none}`)
    console.log(`  por provedor: ${JSON.stringify(stats.byProvider)}`)
  }

  await fs.writeFile('/tmp/cobertura.json', JSON.stringify(report, null, 2))
  console.log('\nRelatório salvo em /tmp/cobertura.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
