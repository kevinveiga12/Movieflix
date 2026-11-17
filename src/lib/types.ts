export type MediaType = 'movie' | 'tv'

export interface Title {
  id: string
  title: string
  description: string
  poster_url: string
  backdrop_url: string
  video_url: string
  vote_average: number | null
  popularity: number
  release_date: string
  category: string
  language: string
  quality: string
  type: MediaType
  media_type: MediaType
  tmdb_id: number
  year: string
  duration: number | null
  seasons?: number
  episodes?: number
  episodes_available?: string[]
  dublado_ptbr?: boolean
}

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  avatar_url: string | null
  is_admin: boolean
  created_at: string
}

/**
 * Schema REAL do Supabase antigo (verificado por sondagem em 2026-11-17).
 * NÃO alterar o banco — o código se adapta a estas colunas.
 *
 * favorites:     id, user_id, media_type, title, tmdb_id, created_at
 * watch_history: id, user_id, media_type, title, poster_url, tmdb_id,
 *                position_seconds, duration_seconds, progress, episode_id, updated_at
 */
export interface FavoriteRow {
  id: string
  user_id: string
  tmdb_id: number | string
  media_type: MediaType
  title: string
  created_at: string
}

export interface HistoryRow {
  id: string
  user_id: string
  tmdb_id: number | string
  media_type: MediaType
  title: string
  poster_url: string | null
  position_seconds: number
  duration_seconds: number
  progress: number | null
  /** "temporada/episódio" para séries, null para filmes. */
  episode_id: string | null
  updated_at: string
}

export interface TmdbSearchResult {
  id: number
  media_type: MediaType
  title?: string
  name?: string
  overview?: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  release_date?: string
  first_air_date?: string
}
