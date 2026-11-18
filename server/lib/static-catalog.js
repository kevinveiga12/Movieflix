import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Catálogo estático — UM único cache para todo o servidor.
 *
 * POR QUE ESTE MÓDULO EXISTE (medido em 2026-11-18)
 * `server/routes/catalog.js` e `server/lib/db-catalog.js` liam e parseavam os
 * mesmos arquivos em caches SEPARADOS. O catálogo tem 27 MB
 * (18.080 filmes + 8.093 séries); parseado duas vezes, o processo passava de
 * ~200 MB de RSS e o app era morto por falta de memória no plano Free da
 * Velixir — o site caía com "This web app isn't running" durante os testes.
 *
 * Aqui o parse acontece uma vez por arquivo e o mesmo array é compartilhado.
 * Nada de dado é alterado: é o mesmo JSON publicado em public/filmes/.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(__dirname, '..', '..', 'public', 'filmes')

const cache = { movie: null, tv: null }
const inflight = { movie: null, tv: null }

const FILES = { movie: 'filmes.light.json', tv: 'series.light.json' }

/**
 * Disponibilidade verificada no provedor (EmbedMovies).
 *
 * `public/filmes/disponibilidade.json` é gerado por
 * `scripts/validar-disponibilidade.cjs`, que pergunta ao player, título a
 * título, se existe fonte de reprodução. O catálogo publicado tem 18.080
 * filmes e 8.093 séries; nem todos estão disponíveis no provedor.
 *
 * Regra: se o arquivo existir e tiver entradas, o catálogo mostra SOMENTE o
 * que foi verificado como disponível. Se o arquivo não existir (ou estiver
 * vazio), não filtramos nada — melhor mostrar o catálogo inteiro do que um
 * site vazio por causa de um arquivo ausente.
 */
let availability = null

async function loadAvailability() {
  if (availability) return availability
  try {
    const raw = await fs.readFile(path.join(PUBLIC, 'disponibilidade.json'), 'utf8')
    const data = JSON.parse(raw)
    const movies = new Set((data.filmes ?? []).map(String))
    const series = new Set((data.series_verificadas ?? Object.keys(data.series ?? {})).map(String))
    availability = {
      movies,
      series,
      // Só filtra quando houve verificação de fato.
      active: movies.size > 0 || series.size > 0,
      geradoEm: data.gerado_em ?? null,
    }
  } catch {
    availability = { movies: new Set(), series: new Set(), active: false, geradoEm: null }
  }
  return availability
}

/** Estatísticas da disponibilidade, para o painel/health. */
export async function availabilityStats() {
  const a = await loadAvailability()
  return {
    active: a.active,
    movies: a.movies.size,
    series: a.series.size,
    geradoEm: a.geradoEm,
  }
}

/**
 * Normaliza o `type` de um registro do catálogo estático.
 *
 * Os arquivos gravam `type: "series"` nas séries, mas TODO o servidor compara
 * com `'tv'` (rotas de episódio, autorização de reprodução, estatísticas).
 * Sem esta normalização, uma série vinda do catálogo estático:
 *   - caía no ramo de filme em /api/playback/authorize → "no_source";
 *   - não era reconhecida como série em seriesEpisodes.
 *
 * Não altera o array em cache: devolve uma cópia com `type`/`media_type` certos.
 */
function normalizeRecord(t) {
  if (!t || typeof t !== 'object') return t
  const raw = String(t.type ?? t.media_type ?? '').toLowerCase()
  const type = raw === 'tv' || raw === 'series' || raw === 'show' ? 'tv' : 'movie'
  if (t.type === type && t.media_type === type) return t
  return { ...t, type, media_type: type }
}

/**
 * Devolve a lista (já parseada) de filmes ou séries.
 * O array é compartilhado — NUNCA o mutar; use filter/map/slice.
 */
export async function loadStatic(kind) {
  if (cache[kind]) return cache[kind]
  if (inflight[kind]) return inflight[kind]

  inflight[kind] = (async () => {
    try {
      const raw = await fs.readFile(path.join(PUBLIC, FILES[kind]), 'utf8')
      const list = JSON.parse(raw)
      // Normaliza uma única vez, no parse — o resto do servidor só vê 'tv'/'movie'.
      let out = Array.isArray(list) ? list.map(normalizeRecord) : []

      // Filtra pelo que o provedor realmente entrega. Sem verificação, mantém tudo.
      const avail = await loadAvailability()
      if (avail.active) {
        const allowed = kind === 'movie' ? avail.movies : avail.series
        if (allowed.size) out = out.filter((t) => allowed.has(String(t.tmdb_id)))
      }

      cache[kind] = out
      return cache[kind]
    } catch {
      cache[kind] = []
      return []
    } finally {
      inflight[kind] = null
    }
  })()

  return inflight[kind]
}

/** Filmes e séries em uma chamada. */
export async function loadBoth() {
  const [movies, series] = await Promise.all([loadStatic('movie'), loadStatic('tv')])
  return { movies, series }
}

/** Busca por tmdb_id nas duas listas. */
export async function findStatic(tmdbId) {
  const id = Number(tmdbId)
  if (!Number.isFinite(id)) return null
  const { movies, series } = await loadBoth()
  return movies.find((t) => Number(t.tmdb_id) === id) ?? series.find((t) => Number(t.tmdb_id) === id) ?? null
}
