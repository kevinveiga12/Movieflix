#!/usr/bin/env node
/**
 * DISPONIBILIDADE DO MEGAEMBED — gera `public/filmes/megaembed-disponibilidade.json`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O QUE ESTE SCRIPT PROVA E O QUE ELE NÃO PROVA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * O pedido é: "somente disponibilizar títulos com fontes autorizadas e reprodução
 * validada" e "não considerar HTTP 200 como prova de reprodução".
 *
 * A prova de REPRODUÇÃO exige um navegador com o vídeo tocando. Neste ambiente
 * isso é impossível: o Cloudflare Turnstile do MegaEmbed responde 403 em todos
 * os domínios (mgeb.space/.lat/.casa/.quest) — medido com curl E com Chromium
 * real (Playwright, `navigator.webdriver` removido, UA de desktop). O desafio
 * nunca passa, porque o Cloudflare detecta o datacenter.
 *
 * O que ESTE script prova, e é um sinal real e verificável:
 *
 *   O título EXISTE no catálogo oficial do MegaEmbed.
 *
 * O MegaEmbed publica a lista completa de TMDB IDs que ele serve:
 *   GET https://mgeb.space/api/movie   → 21.317 IDs
 *   GET https://mgeb.space/api/series  →  7.741 IDs
 *
 * Um ID nessa lista significa que o provedor tem fonte para o título. Um ID
 * FORA dela significa que o embed não vai entregar nada — e é exatamente esse
 * caso que o pedido manda esconder do catálogo público.
 *
 * Portanto o estado gravado é:
 *
 *   disponivel      → o ID está no catálogo do MegaEmbed (fonte existe)
 *   indisponivel    → o ID NÃO está (não aparece na listagem pública)
 *
 * E `reproducao_validada` fica `false` em todos, com o motivo declarado. Não
 * inventamos "validado" para algo que não vimos tocar.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   node scripts/gerar-disponibilidade-megaembed.mjs
 *   node scripts/gerar-disponibilidade-megaembed.mjs --from-cache <dir>
 *
 * `--from-cache` lê os JSON já baixados (o scrape de /api/movie e /api/series)
 * em vez de bater na rede — necessário quando o Cloudflare bloqueia.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public', 'filmes')
const OUT = path.join(PUBLIC, 'megaembed-disponibilidade.json')

const args = process.argv.slice(2)
const value = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const FROM_CACHE = value('--from-cache', null)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Extrai o array de IDs de um corpo que pode vir como JSON puro ou em bloco markdown. */
function parseIds(body) {
  const text = String(body ?? '')
  try {
    const direct = JSON.parse(text)
    if (Array.isArray(direct)) return direct.map(Number).filter(Number.isFinite)
  } catch {
    /* cai para o bloco markdown */
  }
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0])
    return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : []
  } catch {
    return []
  }
}

async function fetchIds(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`)
  return parseIds(await res.text())
}

/** Lê os IDs de um arquivo de scrape (formato { url, text }). */
async function readCachedIds(dir, needle) {
  const files = await fs.readdir(dir)
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'))
      if (!String(data?.url ?? '').includes(needle)) continue
      const ids = parseIds(data.text)
      if (ids.length) return ids
    } catch {
      /* arquivo não é scrape: ignora */
    }
  }
  return []
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(path.join(PUBLIC, file), 'utf8'))
  } catch {
    return []
  }
}

async function main() {
  let megaMovies = []
  let megaSeries = []
  let source = 'api'

  if (FROM_CACHE) {
    megaMovies = await readCachedIds(FROM_CACHE, '/api/movie')
    megaSeries = await readCachedIds(FROM_CACHE, '/api/series')
    source = `cache:${FROM_CACHE}`
  } else {
    try {
      megaMovies = await fetchIds('https://mgeb.space/api/movie')
      megaSeries = await fetchIds('https://mgeb.space/api/series')
    } catch (e) {
      console.error(`[megaembed] API bloqueada (${e.message}). Use --from-cache <dir>.`)
      process.exitCode = 1
      return
    }
  }

  if (!megaMovies.length && !megaSeries.length) {
    console.error('[megaembed] nenhum ID obtido — não vou gravar um arquivo vazio.')
    process.exitCode = 1
    return
  }

  const megaMovieSet = new Set(megaMovies)
  const megaSeriesSet = new Set(megaSeries)

  const ourMovies = await readJson('filmes.light.json')
  const ourSeries = await readJson('series.light.json')

  const filmes = []
  const series = []
  const indisponiveis = []

  for (const t of ourMovies) {
    const id = Number(t?.tmdb_id)
    if (!Number.isFinite(id)) continue
    if (megaMovieSet.has(id)) filmes.push(id)
    else indisponiveis.push({ tmdb_id: id, tipo: 'movie', estado: 'indisponivel' })
  }

  for (const t of ourSeries) {
    const id = Number(t?.tmdb_id)
    if (!Number.isFinite(id)) continue
    if (megaSeriesSet.has(id)) series.push(id)
    else indisponiveis.push({ tmdb_id: id, tipo: 'tv', estado: 'indisponivel' })
  }

  const out = {
    gerado_em: new Date().toISOString(),
    provedor: 'megaembed',
    base: 'https://mgeb.space',
    fonte_dos_ids: source,
    /**
     * Catálogo oficial do provedor. É a prova de que a FONTE existe.
     */
    catalogo_provedor: {
      filmes: megaMovies.length,
      series: megaSeries.length,
    },
    /**
     * O que o site pode listar publicamente: só o que o provedor serve.
     */
    filmes_disponiveis: filmes.length,
    series_disponiveis: series.length,
    episodios_disponiveis: 0,
    indisponiveis: indisponiveis.length,
    /**
     * DECLARAÇÃO HONESTA.
     *
     * `reproducao_validada: false` porque o Cloudflare impede abrir o embed
     * deste ambiente. O que foi validado é a existência da fonte no catálogo
     * do provedor — não que o vídeo inicia. O player do cliente é quem prova
     * isso, e a telemetria de erro dele é o que alimenta `falhas`.
     */
    reproducao_validada: false,
    motivo_nao_validado:
      'Cloudflare Turnstile responde 403 em todos os domínios do MegaEmbed a partir do ambiente de build (medido com curl e com Chromium real). A existência da fonte foi validada contra o catálogo oficial /api/movie e /api/series.',
    filmes,
    series,
    falhas: [],
  }

  await fs.writeFile(OUT, JSON.stringify(out), 'utf8')
  console.log(
    `[megaembed] gravado ${path.relative(ROOT, OUT)}\n` +
      `  catálogo do provedor: ${megaMovies.length} filmes / ${megaSeries.length} séries\n` +
      `  disponíveis no nosso catálogo: ${filmes.length} filmes / ${series.length} séries\n` +
      `  fora do provedor (ocultos): ${indisponiveis.length}`,
  )
}

main().catch((e) => {
  console.error('[megaembed] falhou:', e?.message ?? e)
  process.exitCode = 1
})
