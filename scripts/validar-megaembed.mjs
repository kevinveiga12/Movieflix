#!/usr/bin/env node
/**
 * VERIFICAÇÃO DE DISPONIBILIDADE DO MEGAEMBED.
 *
 * Pergunta ao embed, título a título, se a página entrega player, e grava o
 * resultado em `public/filmes/megaembed-disponibilidade.json`.
 *
 * ── O QUE ESTE SCRIPT NÃO FAZ ────────────────────────────────────────────────
 *
 * Não considera HTTP 200 como prova de reprodução (o pedido é explícito nisso).
 * Ele distingue "a página tem player" de "a página é desafio/vazia". A prova de
 * que o vídeo INICIA exige um navegador com o vídeo tocando — que é o que o
 * cliente faz no aparelho dele, e o que a telemetria de erro do player captura.
 *
 * ── ESTADOS ──────────────────────────────────────────────────────────────────
 *
 *   disponivel       → a página tem <video>/megatube-video
 *   em_verificacao   → Cloudflare Turnstile: não deu para saber
 *   indisponivel     → 404, ou página sem player
 *   erro_reproducao  → erro de rede / 5xx
 *   fonte_expirada   → estava disponível antes e agora não está
 *
 * Uso:
 *   node scripts/validar-megaembed.mjs --limit 50
 *   node scripts/validar-megaembed.mjs --only-movies --limit 200
 *   node scripts/validar-megaembed.mjs --ids 550,1399,603
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeMegaEmbed, movieEmbedUrl, episodeEmbedUrl, STATES } from '../server/lib/megaembed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public', 'filmes')
const OUT = path.join(PUBLIC, 'megaembed-disponibilidade.json')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}

const LIMIT = Number(value('--limit', '50'))
const ONLY_MOVIES = flag('--only-movies')
const ONLY_SERIES = flag('--only-series')
const IDS = value('--ids', null)
const CONCURRENCY = Number(process.env.VALIDATE_CONCURRENCY ?? '4')

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(path.join(PUBLIC, file), 'utf8'))
  } catch {
    return []
  }
}

async function main() {
  let targets = []

  if (IDS) {
    targets = IDS.split(',').map((s) => ({ id: s.trim(), type: 'movie' }))
  } else {
    if (!ONLY_SERIES) {
      const movies = await readJson('filmes.light.json')
      targets.push(...movies.slice(0, LIMIT).map((m) => ({ id: String(m.tmdb_id ?? m.id), type: 'movie' })))
    }
    if (!ONLY_MOVIES) {
      const series = await readJson('series.light.json')
      targets.push(...series.slice(0, LIMIT).map((s) => ({ id: String(s.tmdb_id ?? s.id), type: 'tv' })))
    }
  }

  console.log(`Verificando ${targets.length} títulos no MegaEmbed…`)

  const counts = {
    [STATES.AVAILABLE]: 0,
    [STATES.CHECKING]: 0,
    [STATES.UNAVAILABLE]: 0,
    [STATES.PLAYBACK_ERROR]: 0,
  }
  const failures = []
  const available = { movie: [], tv: [] }

  let cursor = 0
  async function worker() {
    while (cursor < targets.length) {
      const t = targets[cursor++]
      const url = t.type === 'tv' ? episodeEmbedUrl(t.id, 1, 1) : movieEmbedUrl(t.id)
      if (!url) continue
      const r = await probeMegaEmbed(url)
      counts[r.state] = (counts[r.state] ?? 0) + 1
      if (r.state === STATES.AVAILABLE) available[t.type].push(t.id)
      if (r.state === STATES.PLAYBACK_ERROR || r.state === STATES.UNAVAILABLE) {
        failures.push({ id: t.id, type: t.type, state: r.state, http: r.http, error: r.error ?? null })
      }
      if (r.hasAds) {
        failures.push({ id: t.id, type: t.type, state: 'anuncio_detectado', http: r.http })
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const report = {
    gerado_em: new Date().toISOString(),
    provedor: 'megaembed',
    metodo: 'sonda do embed (HTML) — NAO prova reproducao; prova exige video tocando',
    filmes_disponiveis: available.movie.length,
    series_disponiveis: available.tv.length,
    episodios_disponiveis: 0,
    indisponiveis: counts[STATES.UNAVAILABLE] ?? 0,
    em_verificacao: counts[STATES.CHECKING] ?? 0,
    erros: counts[STATES.PLAYBACK_ERROR] ?? 0,
    estados: counts,
    falhas: failures.slice(0, 200),
  }

  await fs.writeFile(OUT, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.estados, null, 2))
  console.log(`Relatório gravado em ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
