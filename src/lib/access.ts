import { supabase } from './supabase'
import type { Plan, Subscription, PlaybackAuth, DbSeason, Title } from './types'

/**
 * Acesso a conteúdo e planos — sempre via backend.
 *
 * REGRA CRÍTICA: a decisão de "pode assistir?" NÃO é tomada no navegador.
 * O frontend só chama /api/playback/authorize com o token do usuário; o
 * servidor valida o Auth, a assinatura, a validade e o plano exigido, e só
 * então devolve a URL do vídeo. Nada aqui contorna o servidor.
 */

export const WHATSAPP_NUMBER = '5511943750307'
export const WHATSAPP_DISPLAY = '(11) 94375-0307'

function whatsappUrl(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`
}

export { whatsappUrl }

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Servidor de arquivos estático devolve HTML — sinal claro de que a API
    // não está no ar (é exatamente o caso do Velixir servindo só o dist/).
    throw new Error(
      `A API não respondeu em ${path}. O servidor Node precisa estar em execução (não apenas os arquivos estáticos).`,
    )
  }
  if (!res.ok) {
    const message =
      (body as { error?: string; message?: string } | null)?.error ??
      (body as { message?: string } | null)?.message ??
      `Falha em ${path} (HTTP ${res.status}).`
    const err = new Error(message) as Error & { status?: number; body?: unknown }
    err.status = res.status
    err.body = body
    throw err
  }
  return body as T
}

/** Planos reais (preços vêm do banco). */
export async function fetchPlans(): Promise<{ plans: Plan[]; whatsapp: { number: string; display: string } }> {
  return getJson('/api/plans')
}

/** Assinatura do usuário logado. */
export async function fetchSubscription(): Promise<{ subscription: Subscription | null; active: boolean }> {
  const headers = await authHeader()
  if (!headers.Authorization) return { subscription: null, active: false }
  try {
    return await getJson('/api/subscription', { headers })
  } catch {
    return { subscription: null, active: false }
  }
}

/**
 * Pede autorização de reprodução ao servidor.
 * Sempre devolve um objeto — nunca lança por 401/402/403, porque a UI precisa
 * mostrar o motivo (criar conta, assinar, plano maior).
 */
export async function authorizePlayback(args: {
  tmdbId: number | string
  season?: number
  episode?: number
}): Promise<PlaybackAuth> {
  const headers = await authHeader()
  try {
    return await getJson<PlaybackAuth>('/api/playback/authorize', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tmdbId: Number(args.tmdbId),
        season: args.season ?? null,
        episode: args.episode ?? null,
      }),
    })
  } catch (e) {
    const err = e as Error & { status?: number; body?: PlaybackAuth }
    if (err.body && typeof err.body === 'object') return err.body
    return {
      allowed: false,
      reason: err.status === 401 ? 'unauthenticated' : undefined,
      message: err.message,
    }
  }
}

/** Filmes cadastrados no painel (com fonte de vídeo real). */
export async function fetchDbMovies(params: { limit?: number; offset?: number; q?: string; genre?: string } = {}) {
  const qs = new URLSearchParams()
  qs.set('limit', String(params.limit ?? 60))
  if (params.offset) qs.set('offset', String(params.offset))
  if (params.q) qs.set('q', params.q)
  if (params.genre) qs.set('genre', params.genre)
  return getJson<{ total: number; items: Title[] }>(`/api/db/movies?${qs.toString()}`)
}

/** Temporadas e episódios reais de uma série. */
export async function fetchSeriesEpisodes(tmdbId: string | number) {
  return getJson<{ seasons: DbSeason[]; missing?: boolean }>(`/api/db/series/${tmdbId}/episodes`)
}

/** É uma URL de arquivo reproduzível pelo <video>? */
export function isDirectMedia(url: string): boolean {
  return /\.(mp4|m4v|webm|m3u8|mpd)(\?|#|$)/i.test(url)
}
