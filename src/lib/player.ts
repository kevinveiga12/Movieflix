import type { Title } from './types'

/**
 * Resolução da fonte de reprodução.
 *
 * O MovieFlix original usa o provedor StreamBetter, que entrega uma página de
 * embed (não um arquivo .mp4/.m3u8 direto). Por isso o player tem dois modos:
 *
 *  - 'direct'  → URL de arquivo (MP4/HLS). Usa <video> nativo + hls.js.
 *  - 'embed'   → página do provedor. Usa <iframe> com sandbox restritivo.
 *
 * O administrador pode cadastrar uma URL direta em `video_url`; se ela for um
 * arquivo, o player usa o modo nativo (melhor experiência: legendas, áudio,
 * retomada precisa). Caso contrário cai no embed.
 */

export type PlaybackMode = 'direct' | 'embed'

export interface PlaybackSource {
  mode: PlaybackMode
  url: string
  /** Rótulo exibido na UI, ex.: "T1 E3". */
  label?: string
}

const DIRECT_EXT = /\.(mp4|m4v|webm|m3u8|mpd)(\?|#|$)/i

export function isDirectUrl(url: string): boolean {
  return DIRECT_EXT.test(url)
}

export function movieSource(t: Title): PlaybackSource | null {
  if (!t.video_url) return null
  return {
    mode: isDirectUrl(t.video_url) ? 'direct' : 'embed',
    url: t.video_url,
  }
}

/**
 * Monta a URL de um episódio.
 *
 * O catálogo guarda `episodes_available` como ["1/1", "1/2", ...] (temporada/
 * episódio). O provedor usa o padrão /serie/{tmdb_id}/{temporada}/{episodio}.
 */
export function episodeSource(t: Title, season: number, episode: number): PlaybackSource | null {
  const available = t.episodes_available ?? []
  const key = `${season}/${episode}`
  if (!available.includes(key)) return null

  // Se o admin cadastrou uma URL direta por episódio, ela tem prioridade.
  if (t.video_url && isDirectUrl(t.video_url)) {
    return { mode: 'direct', url: t.video_url, label: `T${season} E${episode}` }
  }

  const base = t.video_url || `https://streambetter.shop/serie/${t.tmdb_id}`
  const url = t.video_url
    ? `${base.replace(/\/$/, '')}/${season}/${episode}?lang=pt-BR`
    : `${base}/${season}/${episode}?lang=pt-BR`

  return { mode: 'embed', url, label: `T${season} E${episode}` }
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
