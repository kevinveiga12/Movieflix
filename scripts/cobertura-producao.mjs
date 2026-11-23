/**
 * COBERTURA EM PRODUÇÃO — quantos títulos entregam um manifesto HLS REAL.
 *
 * Diferente de "HTTP 200": aqui baixamos o manifesto pelo proxy de produção e
 * exigimos `#EXTM3U` no corpo. É a diferença entre "a página abriu" e "o vídeo
 * tem playlist para tocar".
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = 'https://movieflix.velixir.run'
const PUBLIC = path.join(process.cwd(), 'public', 'filmes')

async function chainFor(tmdbId, season, episode) {
  const { resolvePlaybackChain } = await import('../server/lib/playback-chain.js')
  return resolvePlaybackChain({ tmdbId: String(tmdbId), season, episode })
}

async function manifestOk(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(BASE + url, { signal: ctrl.signal })
    if (!res.ok) return { ok: false, why: `http_${res.status}` }
    const text = await res.text()
    return text.startsWith('#EXTM3U')
      ? { ok: true, bytes: text.length }
      : { ok: false, why: 'not_m3u8' }
  } catch (e) {
    return { ok: false, why: 'timeout' }
  } finally {
    clearTimeout(t)
  }
}

async function sample(file, n) {
  const list = JSON.parse(await fs.readFile(path.join(PUBLIC, file), 'utf8'))
  const step = Math.max(1, Math.floor(list.length / n))
  const out = []
  for (let i = 0; i < list.length && out.length < n; i += step) out.push(list[i])
  return out
}

async function run(kind, file, n) {
  const items = await sample(file, n)
  const stats = { total: items.length, playable: 0, noSource: 0, badManifest: 0 }
  const fails = []
  for (const t of items) {
    const id = t.tmdb_id ?? t.id
    const chain = await chainFor(id, kind === 'tv' ? 1 : null, kind === 'tv' ? 1 : null)
    if (!chain.length) {
      stats.noSource++
      fails.push({ id, title: t.title, why: 'sem_fonte' })
      continue
    }
    const r = await manifestOk(chain[0].url)
    if (r.ok) stats.playable++
    else {
      stats.badManifest++
      fails.push({ id, title: t.title, why: r.why })
    }
  }
  console.log(`\n=== ${kind.toUpperCase()} (${stats.total} amostrados) ===`)
  console.log(`  manifesto HLS real: ${stats.playable}`)
  console.log(`  sem fonte:          ${stats.noSource}`)
  console.log(`  fonte mas sem HLS:  ${stats.badManifest}`)
  if (fails.length) console.log('  falhas:', JSON.stringify(fails.slice(0, 6)))
  return stats
}

const m = await run('movie', 'filmes.light.json', Number(process.argv[2] ?? 20))
const s = await run('tv', 'series.light.json', Number(process.argv[3] ?? 12))
await fs.writeFile('/tmp/cobertura-prod.json', JSON.stringify({ m, s }, null, 2))
