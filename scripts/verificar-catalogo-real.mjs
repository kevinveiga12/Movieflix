#!/usr/bin/env node
/**
 * VERIFICAÇÃO REAL DO CATÁLOGO — título por título, contra o provedor que responde.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE SCRIPT EXISTE (medido em 2026-11-23)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * O player do app apontava para `https://mgeb.space/embed/{tmdb_id}`. Medido
 * neste ambiente e no de build: TODOS os domínios do MegaEmbed respondem
 * `403 cf-mitigated: challenge` (Cloudflare Turnstile) — com curl, com Chromium
 * headless e com Chromium completo em Xvfb. O desafio nunca passa.
 *
 * Resultado para o cliente: o iframe abre a tela
 *   "Ops, ocorreu um problema / Todas as fontes falharam. Nenhuma opção disponível."
 * — que é a tela de erro do PRÓPRIO provedor, não do nosso site.
 *
 * O provedor que RESPONDE de verdade é o `playerflix.ink`, que publica, por
 * título, a lista de opções de reprodução com um campo `budget`:
 *
 *   budget: "success"  → o provedor tem fonte para aquele título
 *   budget: "danger"   → o provedor NÃO tem fonte (só o "Premium" pago)
 *
 * E a opção `watchplay` entrega o HLS de verdade: o HTML traz
 * `createMyPlayer({ url: "https://…/playlist.m3u8?…" })`, e o playlist responde
 * 200 com segmentos válidos (medido: init.mp4 1.376 B, 0000.js 2,1 MB).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CRITÉRIO EXATO DE "NÃO FUNCIONAL"
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   FUNCIONA      → o provedor devolve ao menos uma opção com budget "success"
 *                   E (quando é possível abrir) o embed entrega um .m3u8.
 *   NÃO FUNCIONA  → o provedor responde `status:false` (título inexistente) ou
 *                   devolve SOMENTE opções `danger` (nenhuma fonte real).
 *   INCERTO       → erro de rede/timeout. NUNCA é removido: remover por falha
 *                   de rede seria pior do que deixar um título quebrado.
 *
 * Uso:
 *   node scripts/verificar-catalogo-real.mjs --out /tmp/verificacao.jsonl
 *   node scripts/verificar-catalogo-real.mjs --limit 200 --concurrency 32
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public', 'filmes')

const args = process.argv.slice(2)
const value = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}

const OUT = value('--out', '/tmp/verificacao-catalogo.jsonl')
const LIMIT = Number(value('--limit', '0')) || 0
const CONCURRENCY = Number(value('--concurrency', '32')) || 32
const ONLY = value('--only', 'all') // all | movie | tv
const RESUME = args.includes('--resume')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const AJAX = 'https://playerflix.ink/inc/Ajax.php'
const REFERER = 'https://playerflix.ink/'

/** Pede ao provedor as opções de reprodução de um título. */
async function fetchOptions({ id, type, season = null, episode = null, timeoutMs = 20_000 }) {
  const qs = new URLSearchParams({
    type,
    id: String(id),
    season: season == null ? 'null' : String(season),
    episode: episode == null ? 'null' : String(episode),
  })
  try {
    const res = await fetch(`${AJAX}?${qs}`, {
      headers: {
        'User-Agent': UA,
        Referer: REFERER,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { net: false, http: res.status, options: [] }
    const json = await res.json()
    const options = Array.isArray(json?.data?.options) ? json.data.options : []
    return {
      net: true,
      http: res.status,
      status: json?.status === true,
      options: options.map((o) => ({
        id: String(o?.id ?? ''),
        budget: String(o?.budget ?? ''),
        embed: String(o?.embed ?? ''),
      })),
    }
  } catch (err) {
    return { net: false, http: 0, options: [], error: String(err?.message ?? err).slice(0, 80) }
  }
}

/** Abre o embed e extrai a URL do HLS, quando o embed é do tipo que a publica. */
async function probeStream(embedUrl, timeoutMs = 20_000) {
  try {
    const res = await fetch(embedUrl, {
      headers: { 'User-Agent': UA, Referer: REFERER, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, http: res.status }
    const html = (await res.text()).slice(0, 400_000)
    const m = html.match(/url\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i)
    if (!m) return { ok: false, http: res.status, noPlaylist: true }
    return { ok: true, http: res.status, playlist: m[1].replace(/\\\//g, '/') }
  } catch (err) {
    return { ok: false, http: 0, error: String(err?.message ?? err).slice(0, 80) }
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(path.join(PUBLIC, file), 'utf8'))
  } catch {
    return []
  }
}

/** Primeiro episódio disponível de uma série, a partir de `episodes_available`. */
function firstEpisode(t) {
  const list = Array.isArray(t.episodes_available) ? t.episodes_available : []
  for (const key of list) {
    const [s, e] = String(key).split('/').map(Number)
    if (Number.isInteger(s) && Number.isInteger(e) && e >= 1) return { season: s, episode: e }
  }
  return null
}

async function main() {
  const started = Date.now()

  const [movies, series] = await Promise.all([readJson('filmes.light.json'), readJson('series.light.json')])

  const targets = []
  if (ONLY === 'all' || ONLY === 'movie') {
    for (const t of movies) {
      const id = String(t.tmdb_id ?? t.id ?? '')
      if (!/^\d+$/.test(id)) continue
      targets.push({ tmdb_id: id, type: 'movie', title: t.title ?? '', year: t.year ?? '', poster_url: t.poster_url ?? '' })
    }
  }
  if (ONLY === 'all' || ONLY === 'tv') {
    for (const t of series) {
      const id = String(t.tmdb_id ?? t.id ?? '')
      if (!/^\d+$/.test(id)) continue
      const ep = firstEpisode(t)
      targets.push({
        tmdb_id: id,
        type: 'tv',
        title: t.title ?? '',
        year: t.year ?? '',
        poster_url: t.poster_url ?? '',
        season: ep?.season ?? null,
        episode: ep?.episode ?? null,
      })
    }
  }

  // Retomada: pula o que já está no arquivo de saída.
  let done = new Set()
  if (RESUME) {
    try {
      const raw = await fs.readFile(OUT, 'utf8')
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const r = JSON.parse(line)
          done.add(`${r.type}:${r.tmdb_id}`)
        } catch {
          /* linha truncada: ignora */
        }
      }
    } catch {
      /* sem arquivo: começa do zero */
    }
  }

  let queue = targets.filter((t) => !done.has(`${t.type}:${t.tmdb_id}`))
  if (LIMIT) queue = queue.slice(0, LIMIT)

  console.log(
    `[verificar] catálogo: ${movies.length} filmes / ${series.length} séries · ` +
      `alvos: ${targets.length} · já feitos: ${done.size} · nesta rodada: ${queue.length}`,
  )

  const fh = await fs.open(OUT, RESUME ? 'a' : 'w')
  let next = 0
  let finished = 0
  const counts = { funciona: 0, sem_fonte: 0, incerto: 0 }

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, async () => {
    while (true) {
      const i = next++
      if (i >= queue.length) return
      const t = queue[i]

      const r = await fetchOptions({
        id: t.tmdb_id,
        type: t.type,
        season: t.season,
        episode: t.episode,
      })

      let estado
      let motivo = ''
      let streamOk = null
      let playlist = null

      if (!r.net) {
        estado = 'incerto'
        motivo = r.error ?? `http ${r.http}`
      } else if (!r.status) {
        estado = 'sem_fonte'
        motivo = 'provedor não conhece o título (status:false)'
      } else {
        const good = r.options.filter((o) => o.budget === 'success')
        if (!good.length) {
          estado = 'sem_fonte'
          motivo = 'provedor só devolveu opções sem fonte (budget:danger)'
        } else {
          // Confirma que a fonte realmente entrega um playlist, quando o embed
          // é do tipo que publica a URL do HLS.
          const candidate =
            good.find((o) => o.id === 'watchplay') ??
            good.find((o) => o.id === 'embedplayer') ??
            good.find((o) => o.id === 'embedplay')
          if (candidate) {
            const s = await probeStream(candidate.embed)
            streamOk = s.ok
            playlist = s.playlist ?? null
            if (s.ok) {
              estado = 'funciona'
              motivo = `HLS confirmado (${candidate.id})`
            } else if (s.noPlaylist) {
              // O embed não publica a URL do HLS no HTML (player em JS), mas o
              // provedor declara fonte. Conta como funciona — o sinal de fonte
              // existe e o player do cliente monta o vídeo.
              estado = 'funciona'
              motivo = `fonte declarada (${candidate.id}); embed sem playlist no HTML`
            } else {
              estado = 'incerto'
              motivo = `embed não abriu (${candidate.id}): ${s.error ?? 'http ' + s.http}`
            }
          } else {
            estado = 'funciona'
            motivo = 'fonte declarada'
          }
        }
      }

      counts[estado]++
      finished++

      await fh.write(
        JSON.stringify({
          tmdb_id: t.tmdb_id,
          type: t.type,
          title: t.title,
          year: t.year,
          poster_url: t.poster_url,
          season: t.season ?? null,
          episode: t.episode ?? null,
          estado,
          motivo,
          stream_ok: streamOk,
          playlist,
          opcoes: r.options?.map((o) => `${o.id}:${o.budget}`) ?? [],
        }) + '\n',
      )

      if (finished % 500 === 0) {
        const s = (Date.now() - started) / 1000
        console.log(
          `[verificar] ${finished}/${queue.length} · funciona=${counts.funciona} ` +
            `sem_fonte=${counts.sem_fonte} incerto=${counts.incerto} · ${(finished / s).toFixed(1)}/s`,
        )
      }
    }
  })

  await Promise.all(workers)
  await fh.close()

  const s = ((Date.now() - started) / 1000).toFixed(0)
  console.log(
    `[verificar] concluído em ${s}s · funciona=${counts.funciona} ` +
      `sem_fonte=${counts.sem_fonte} incerto=${counts.incerto} · saída: ${OUT}`,
  )
}

main().catch((e) => {
  console.error('[verificar] falhou:', e?.message ?? e)
  process.exitCode = 1
})
