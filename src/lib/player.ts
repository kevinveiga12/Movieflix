import type { Title } from './types'

/**
 * Resolução da fonte de reprodução.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * PROVEDOR ÚNICO: MEGAEMBED (o player vermelho)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * O player azul (myembed.biz → playerflix.ink → v1.watchplay.shop) foi removido
 * do fluxo de reprodução por completo. Contrato do MegaEmbed, conforme a
 * documentação oficial:
 *
 *   Filme            https://mgeb.space/embed/{tmdb_id}
 *   Filme (IMDb)     https://mgeb.space/embed/tt{imdb_id}
 *   Série (episódio) https://mgeb.space/embed/{tmdb_id}/{temporada}/{episodio}
 *   Player forçado   ?player=megaplay|megatube|vidstack|clappr
 *
 * A reprodução funciona EXCLUSIVAMENTE via iframe — o provedor não entrega
 * .mp4/.m3u8. Por isso o player tem dois modos:
 *
 *  - 'direct'  → URL de arquivo (MP4/HLS) cadastrada pelo admin. <video> nativo.
 *  - 'embed'   → página do provedor. <iframe> com sandbox restritivo.
 *
 * O admin pode cadastrar uma URL direta em `video_url`; se ela for um arquivo,
 * o player usa o modo nativo (melhor experiência: legendas, áudio, retomada
 * precisa). Caso contrário cai no embed do EmbedMovies.
 */

export type PlaybackMode = 'direct' | 'embed'

export interface PlaybackSource {
  mode: PlaybackMode
  url: string
  /** Rótulo exibido na UI, ex.: "T1 E3". */
  label?: string
}

/** Domínio do provedor de embed. */
export const EMBED_PROVIDER = 'https://mgeb.space'

const DIRECT_EXT = /\.(mp4|m4v|webm|m3u8|mpd)(\?|#|$)/i

export function isDirectUrl(url: string): boolean {
  return DIRECT_EXT.test(url)
}

/**
 * URL de embed de um filme.
 *
 * Aceita o id numérico do TMDB ou um id IMDb ("tt..."). O catálogo guarda
 * `tmdb_id` numérico, então o caminho normal é o numérico.
 */
export function movieEmbedUrl(id: string | number): string | null {
  const raw = String(id ?? '').trim()
  if (!raw) return null
  if (/^tt\d+$/i.test(raw)) return `${EMBED_PROVIDER}/embed/${raw.toLowerCase()}`
  if (!/^\d+$/.test(raw)) return null
  return `${EMBED_PROVIDER}/embed/${raw}`
}

/** URL de embed de um episódio específico. */
export function episodeEmbedUrl(
  id: string | number,
  season: number,
  episode: number,
): string | null {
  const raw = String(id ?? '').trim()
  if (!/^\d+$/.test(raw)) return null
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null
  if (season < 1 || episode < 1) return null
  return `${EMBED_PROVIDER}/embed/${raw}/${season}/${episode}`
}

/** URL de embed da série (mostra a lista de temporadas/episódios). */
export function seriesEmbedUrl(id: string | number): string | null {
  const raw = String(id ?? '').trim()
  if (!/^\d+$/.test(raw)) return null
  return `${EMBED_PROVIDER}/embed/${raw}`
}

export function movieSource(t: Title): PlaybackSource | null {
  // URL direta cadastrada pelo admin tem prioridade.
  if (t.video_url && isDirectUrl(t.video_url)) {
    return { mode: 'direct', url: t.video_url }
  }
  const url = movieEmbedUrl(t.tmdb_id ?? t.id)
  return url ? { mode: 'embed', url } : null
}

/**
 * Monta a fonte de um episódio.
 *
 * O catálogo guarda `episodes_available` como ["1/1", "1/2", ...] (temporada/
 * episódio). Só liberamos o episódio que está nessa lista — evita mandar o
 * cliente para um episódio que o provedor não tem.
 */
export function episodeSource(t: Title, season: number, episode: number): PlaybackSource | null {
  const available = t.episodes_available ?? []
  const key = `${season}/${episode}`
  if (available.length && !available.includes(key)) return null

  // Se o admin cadastrou uma URL direta por episódio, ela tem prioridade.
  if (t.video_url && isDirectUrl(t.video_url)) {
    return { mode: 'direct', url: t.video_url, label: `T${season} E${episode}` }
  }

  const url = episodeEmbedUrl(t.tmdb_id ?? t.id, season, episode)
  return url ? { mode: 'embed', url, label: `T${season} E${episode}` } : null
}

export function firstEpisode(t: Title): { season: number; episode: number } | null {
  const first = t.episodes_available?.[0]
  if (!first) return null
  const [s, e] = first.split('/').map(Number)
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null
  return { season: s, episode: e }
}

export function nextEpisode(
  t: Title,
  season: number,
  episode: number,
): { season: number; episode: number } | null {
  const available = t.episodes_available ?? []
  const idx = available.indexOf(`${season}/${episode}`)
  if (idx === -1 || idx + 1 >= available.length) return null
  const [s, e] = available[idx + 1].split('/').map(Number)
  return { season: s, episode: e }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
