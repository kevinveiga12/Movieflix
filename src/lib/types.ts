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
  /** Plano exigido para reproduzir: 'simple' | 'standard' | 'premium'. */
  required_plan?: string | null
  /** 'database' = cadastrado no painel e com fonte real; ausente = só metadados. */
  source?: 'database'
}

export interface PlanPeriod {
  code: '1m' | '3m' | '12m'
  label: string
  months: number
  price_cents: number
  price_label: string
  /** 'monthly' | 'configured' | 'derived' (mensal x meses, sem desconto definido) */
  price_source: 'monthly' | 'configured' | 'derived'
  whatsapp_url: string
}

export interface Plan {
  id: string
  name: string
  code: string
  description: string | null
  price_cents: number
  price_label?: string
  features: string[] | null
  duration_days: number
  is_active: boolean
  whatsapp_url?: string
  /** Tabela por período: 1 mês / 3 meses / 1 ano. */
  periods?: PlanPeriod[]
}

export interface Subscription {
  id?: string
  user_id?: string
  plan_id?: string | null
  plan_code: string | null
  status: string
  expires_at: string | null
  active?: boolean
  plan_label?: string
  created_at?: string
  updated_at?: string
}

export interface DbEpisode {
  id: number
  season_id: number
  episode_number: number
  title: string | null
  description: string | null
  video_url: string | null
  duration_seconds: number | null
  thumbnail_url: string | null
}

export interface DbSeason {
  id: number
  season_number: number
  title: string | null
  poster_url: string | null
  episodes: DbEpisode[]
}

/** Resposta de POST /api/playback/authorize */
export interface PlaybackAuth {
  allowed: boolean
  title?: { tmdb_id: number; title: string; quality: string | null }
  reason?: 'unauthenticated' | 'no_subscription' | 'plan_too_low' | 'no_source' | 'not_in_catalog' | 'episode_not_found' | 'bad_request' | 'episode_required' | 'trial_expired' | 'trial_unknown'
  /** Situação do mês grátis / plano, decidida no servidor. */
  access?: {
    allowed: boolean
    reason: string
    trialEndsAt: string | null
    daysLeft: number | null
    plan: { code: string; expires_at: string } | null
  } | null
  message?: string
  source?: { url: string; label: string | null; mode: 'direct' | 'embed' }
  plan?: { code: string | null; label: string; expires_at: string | null }
  requiredPlan?: string | null
  subscription?: { plan_code: string | null; status: string; expires_at: string | null } | null
}

export interface Profile {
  id: string
  email: string | null
  name: string | null
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
