/**
 * Catálogo administrado, vindo do Supabase.
 *
 * Fonte de verdade do que tem reprodução REAL e plano exigido:
 *   movies(id, tmdb_id, title, description, poster_url, backdrop_url,
 *          video_url, language, quality, type, required_plan, category,
 *          duration, year, created_at)
 *   seasons(id, series_id, season_number, title, poster_url, created_at)
 *   episodes(id, season_id, episode_number, title, description, video_url,
 *            duration_seconds, thumbnail_url, created_at)
 *
 * Observação verificada: `seasons.series_id` aponta para `movies.id`, não para
 * `tmdb_id`. E, hoje, as 2 temporadas existentes apontam para series_id=17, que
 * NÃO existe em `movies` (registro removido). Tratamos isso como dado órfão:
 * as temporadas sem série são ignoradas em vez de exibidas como episódios de
 * uma série inventada.
 */

import { getAnonClient, hasDb } from './supabase-server.js'

function db() {
  return getAnonClient()
}

export const hasDbCatalog = hasDb

const SELECT =
  'id, tmdb_id, title, description, poster_url, backdrop_url, video_url, ' +
  'language, quality, type, required_plan, category, duration, year'

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

/** Lista filmes do banco (paginado). */
export async function listMovies({ limit = 60, offset = 0, genre, q } = {}) {
  const d = db()
  if (!d) return { total: 0, items: [], unavailable: true }

  let query = d.from('movies').select(SELECT, { count: 'exact' }).eq('type', 'movie')
  if (genre && genre !== 'Todos') query = query.ilike('category', `%${genre}%`)
  if (q) query = query.ilike('title', `%${q}%`)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return { total: 0, items: [], error: error.message }
  return { total: count ?? (data?.length ?? 0), items: (data ?? []).map(toTitle) }
}

/** Busca um título do banco por tmdb_id. */
export async function findTitle(tmdbId) {
  const d = db()
  if (!d) return null
  const { data, error } = await d
    .from('movies')
    .select(SELECT)
    .eq('tmdb_id', Number(tmdbId))
    .maybeSingle()
  if (error || !data) return null
  return toTitle(data)
}

/**
 * Temporadas + episódios de uma série.
 * `tmdbId` é convertido para `movies.id` (a FK que `seasons` usa).
 */
export async function seriesEpisodes(tmdbId) {
  const d = db()
  if (!d) return { seasons: [], orphaned: false }

  const { data: movie } = await d
    .from('movies')
    .select('id, tmdb_id, type')
    .eq('tmdb_id', Number(tmdbId))
    .maybeSingle()

  if (!movie) return { seasons: [], orphaned: false, missing: true }

  const { data: seasons, error: sErr } = await d
    .from('seasons')
    .select('id, season_number, title, poster_url')
    .eq('series_id', movie.id)
    .order('season_number', { ascending: true })

  if (sErr || !seasons?.length) return { seasons: [] }

  const seasonIds = seasons.map((s) => s.id)
  const { data: episodes, error: eErr } = await d
    .from('episodes')
    .select('id, season_id, episode_number, title, description, video_url, duration_seconds, thumbnail_url')
    .in('season_id', seasonIds)
    .order('episode_number', { ascending: true })

  if (eErr) return { seasons: seasons.map((s) => ({ ...s, episodes: [] })) }

  return {
    seasons: seasons.map((s) => ({
      ...s,
      episodes: (episodes ?? []).filter((e) => e.season_id === s.id),
    })),
  }
}

/** Contadores para o painel/health. */
export async function catalogStats() {
  const d = db()
  if (!d) return null
  const [movies, seasons, episodes] = await Promise.all([
    d.from('movies').select('id', { count: 'exact', head: true }),
    d.from('seasons').select('id', { count: 'exact', head: true }),
    d.from('episodes').select('id', { count: 'exact', head: true }),
  ])
  return {
    movies: movies.count ?? 0,
    seasons: seasons.count ?? 0,
    episodes: episodes.count ?? 0,
  }
}

/**
 * Detecta temporadas órfãs (series_id que não existe em movies).
 * Reportado no health para o proprietário saber que há dado inconsistente.
 */
export async function orphanSeasons() {
  const d = db()
  if (!d) return []
  const { data: seasons } = await d.from('seasons').select('id, series_id, season_number')
  const { data: movies } = await d.from('movies').select('id')
  if (!seasons || !movies) return []
  const ids = new Set(movies.map((m) => m.id))
  return seasons.filter((s) => !ids.has(s.series_id)).map((s) => ({ id: s.id, series_id: s.series_id }))
}
