import { getAnonClient, hasDb } from './supabase-server.js'
import { loadStatic, findStatic } from './static-catalog.js'

/**
 * Catálogo de reprodução — com DOIS backends.
 *
 * 1. Supabase (tabelas `movies`, `seasons`, `episodes`)
 *    Usado quando o projeto tem essas tabelas. É o caminho "administrado":
 *    o que o painel cadastra aparece aqui.
 *
 * 2. Catálogo estático (public/filmes/*.light.json)
 *    O projeto Supabase atual (zhsfqptngzgbcgiwwjug) NÃO tem `movies`,
 *    `seasons` nem `episodes` — verificado em 2026-11-18 (PGRST205). Sem
 *    fallback, TODA reprodução era negada com `not_in_catalog`, mesmo com
 *    18.080 filmes e 8.093 séries no catálogo publicado.
 *
 *    O catálogo estático já traz `video_url` em todos os 18.080 filmes e
 *    `episodes_available` (["1/1","1/2",...]) em 8.092 séries, então é
 *    suficiente para liberar a reprodução sem inventar nada.
 *
 * A escolha é automática: se as tabelas existirem, o banco manda; senão, o
 * catálogo estático responde. Nenhuma tabela é criada e nenhum dado é alterado.
 */

export const hasDbCatalog = hasDb

const SELECT =
  'id, tmdb_id, title, description, poster_url, backdrop_url, video_url, ' +
  'language, quality, type, required_plan, category, duration, year'

/** Provedor de embed usado pelo catálogo (mesmo do site original). */
const PROVIDER = 'https://streambetter.shop'

// ── Detecção das tabelas do Supabase ─────────────────────────────────────────

let tablesPresent = null

/** As tabelas `movies`/`seasons`/`episodes` existem neste projeto? Cacheado. */
async function dbHasTables() {
  if (tablesPresent !== null) return tablesPresent
  const d = getAnonClient()
  if (!d) {
    tablesPresent = false
    return false
  }
  const { error } = await d.from('movies').select('id').limit(1)
  tablesPresent = !error
  return tablesPresent
}

/** Normaliza a linha do banco para o formato `Title` do frontend. */
function toTitle(row) {
  return {
    id: String(row.tmdb_id),
    tmdb_id: row.tmdb_id,
    title: row.title,
    description: row.description ?? '',
    poster_url: row.poster_url ?? '',
    backdrop_url: row.backdrop_url ?? '',
    video_url: row.video_url ?? '',
    vote_average: null,
    popularity: 0,
    release_date: row.year ? `${row.year}-01-01` : '',
    category: row.category ?? '',
    language: row.language ?? '',
    quality: row.quality ?? '',
    type: row.type === 'tv' ? 'tv' : 'movie',
    media_type: row.type === 'tv' ? 'tv' : 'movie',
    year: row.year ?? '',
    duration: row.duration ?? null,
    required_plan: row.required_plan ?? null,
    source: 'database',
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

/** Lista filmes (paginado). Banco quando existir; senão, catálogo estático. */
export async function listMovies({ limit = 60, offset = 0, genre, q } = {}) {
  if (await dbHasTables()) {
    const d = getAnonClient()
    let query = d.from('movies').select(SELECT, { count: 'exact' }).eq('type', 'movie')
    if (genre && genre !== 'Todos') query = query.ilike('category', `%${genre}%`)
    if (q) query = query.ilike('title', `%${q}%`)

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (!error) return { total: count ?? (data?.length ?? 0), items: (data ?? []).map(toTitle) }
  }

  let list = await loadStatic('movie')
  if (genre && genre !== 'Todos') {
    const wanted = String(genre).toLowerCase()
    list = list.filter((t) =>
      String(t.category ?? '')
        .toLowerCase()
        .split(',')
        .map((s) => s.trim())
        .includes(wanted),
    )
  }
  if (q) {
    const needle = String(q).toLowerCase()
    list = list.filter((t) => String(t.title ?? '').toLowerCase().includes(needle))
  }
  return {
    total: list.length,
    items: list.slice(offset, offset + limit).map((t) => ({ ...t, source: 'catalog' })),
  }
}

/** Busca um título por tmdb_id — banco primeiro, catálogo depois. */
export async function findTitle(tmdbId) {
  const id = Number(tmdbId)
  if (!Number.isFinite(id)) return null

  if (await dbHasTables()) {
    const d = getAnonClient()
    const { data, error } = await d.from('movies').select(SELECT).eq('tmdb_id', id).maybeSingle()
    if (!error && data) return toTitle(data)
  }

  const hit = await findStatic(id)
  return hit ? { ...hit, source: 'catalog' } : null
}

/**
 * Temporadas + episódios de uma série.
 *
 * No banco, `seasons.series_id` aponta para `movies.id` (não para `tmdb_id`).
 * No catálogo estático, as temporadas são derivadas de `episodes_available`
 * (["1/1","1/2",...]) — a mesma estrutura que o player já consome.
 */
export async function seriesEpisodes(tmdbId) {
  const id = Number(tmdbId)

  if (await dbHasTables()) {
    const d = getAnonClient()
    const { data: movie } = await d
      .from('movies')
      .select('id, tmdb_id, type')
      .eq('tmdb_id', id)
      .maybeSingle()

    if (movie) {
      const { data: seasons, error: sErr } = await d
        .from('seasons')
        .select('id, season_number, title, poster_url')
        .eq('series_id', movie.id)
        .order('season_number', { ascending: true })

      if (!sErr && seasons?.length) {
        const seasonIds = seasons.map((s) => s.id)
        const { data: episodes, error: eErr } = await d
          .from('episodes')
          .select(
            'id, season_id, episode_number, title, description, video_url, duration_seconds, thumbnail_url',
          )
          .in('season_id', seasonIds)
          .order('episode_number', { ascending: true })

        if (!eErr) {
          return {
            seasons: seasons.map((s) => ({
              ...s,
              episodes: (episodes ?? []).filter((e) => e.season_id === s.id),
            })),
            source: 'database',
          }
        }
      }
    }
  }

  // Catálogo estático
  const series = await loadStatic('tv')
  const t = series.find((x) => Number(x.tmdb_id) === id)
  if (!t) return { seasons: [], missing: true }

  const available = Array.isArray(t.episodes_available) ? t.episodes_available : []
  if (!available.length) return { seasons: [], missing: false, noEpisodes: true }

  const bySeason = new Map()
  for (const key of available) {
    const [s, e] = String(key).split('/').map(Number)
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue
    if (!bySeason.has(s)) bySeason.set(s, [])
    bySeason.get(s).push(e)
  }

  const seasons = [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, eps]) => ({
      id: `s${s}`,
      season_number: s,
      title: `Temporada ${s}`,
      poster_url: t.poster_url ?? null,
      episodes: eps
        .sort((a, b) => a - b)
        .map((e) => ({
          id: `s${s}e${e}`,
          season_id: `s${s}`,
          episode_number: e,
          title: `Episódio ${e}`,
          description: null,
          video_url: `${PROVIDER}/serie/${t.tmdb_id}/${s}/${e}?lang=pt-BR`,
          duration_seconds: null,
          thumbnail_url: null,
        })),
    }))

  return { seasons, source: 'catalog' }
}

/** Contadores para o painel/health. */
export async function catalogStats() {
  if (await dbHasTables()) {
    const d = getAnonClient()
    const [movies, seasons, episodes] = await Promise.all([
      d.from('movies').select('id', { count: 'exact', head: true }),
      d.from('seasons').select('id', { count: 'exact', head: true }),
      d.from('episodes').select('id', { count: 'exact', head: true }),
    ])
    return {
      movies: movies.count ?? 0,
      seasons: seasons.count ?? 0,
      episodes: episodes.count ?? 0,
      source: 'database',
    }
  }

  const [movies, series] = await Promise.all([loadStatic('movie'), loadStatic('tv')])
  const episodes = series.reduce(
    (n, t) => n + (Array.isArray(t.episodes_available) ? t.episodes_available.length : 0),
    0,
  )
  return {
    movies: movies.length,
    series: series.length,
    seasons: series.reduce((n, t) => n + (Number(t.seasons) || 0), 0),
    episodes,
    source: 'catalog',
  }
}

/**
 * Detecta temporadas órfãs (series_id que não existe em movies).
 * Só faz sentido quando as tabelas existem; senão devolve lista vazia.
 */
export async function orphanSeasons() {
  if (!(await dbHasTables())) return []
  const d = getAnonClient()
  const { data: seasons } = await d.from('seasons').select('id, series_id, season_number')
  const { data: movies } = await d.from('movies').select('id')
  if (!seasons || !movies) return []
  const ids = new Set(movies.map((m) => m.id))
  return seasons.filter((s) => !ids.has(s.series_id)).map((s) => ({ id: s.id, series_id: s.series_id }))
}
