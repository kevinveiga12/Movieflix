import { supabase } from './supabase'
import type { Plan, Subscription, PlaybackAuth, DbSeason, Title, PixCharge } from './types'

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

/**
 * Cria uma cobrança Pix no Mercado Pago.
 *
 * O valor NÃO é enviado: o servidor resolve o preço do plano/período com a
 * mesma função que a tela de planos usa. Mandar o valor daqui permitiria
 * pedir Premium pagando Básico.
 */
export async function createPixCharge(args: {
  planCode: string
  period: string
  cpf: string
}): Promise<PixCharge> {
  const headers = await authHeader()
  return getJson<PixCharge>('/api/payments/pix', {
    method: 'POST',
    headers,
    body: JSON.stringify({ plan_code: args.planCode, period: args.period, cpf: args.cpf }),
  })
}

/** Status de um pagamento — a tela usa em polling até aprovar ou expirar. */
export async function fetchPaymentStatus(paymentId: string): Promise<PixCharge> {
  const headers = await authHeader()
  return getJson<PixCharge>(`/api/payments/${encodeURIComponent(paymentId)}/status`, { headers })
}

/** O Pix está disponível neste servidor? (MP_ACCESS_TOKEN configurado) */
export async function fetchPixConfig(): Promise<{ pix_enabled: boolean; mode: string }> {
  try {
    return await getJson('/api/payments/config')
  } catch {
    return { pix_enabled: false, mode: 'unconfigured' }
  }
}

/** Planos reais (preços vêm do banco). */
export async function fetchPlans(email?: string | null): Promise<{ plans: Plan[]; whatsapp: { number: string; display: string } }> {
  const qs = email ? `?email=${encodeURIComponent(email)}` : ''
  return getJson(`/api/plans${qs}`)
}

/** Assinatura do usuário logado. */
export async function fetchSubscription(): Promise<{
  subscription: Subscription | null
  active: boolean
  access?: {
    allowed: boolean
    reason: string
    trialEndsAt: string | null
    daysLeft: number | null
    plan: { code: string; expires_at: string } | null
  }
}> {
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

/**
 * Libera 1 mês grátis com o código que o administrador enviou.
 *
 * A validação é 100% no servidor (`POST /api/trial/redeem`): o navegador só
 * envia o que o cliente digitou. O código é comparado com o hash guardado em
 * `app_metadata` — campo que o cliente não consegue escrever. Editar o
 * frontend não libera nada.
 */
export async function redeemTrialCode(code: string): Promise<{
  ok: boolean
  endsAt?: string | null
  days?: number
  message?: string
  error?: string
  attemptsLeft?: number | null
}> {
  const headers = await authHeader()
  try {
    return await getJson('/api/trial/redeem', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code }),
    })
  } catch (e) {
    const err = e as Error & { status?: number; body?: { error?: string; attemptsLeft?: number } }
    return {
      ok: false,
      error: err.body?.error ?? err.message,
      attemptsLeft: err.body?.attemptsLeft ?? null,
    }
  }
}

/**
 * Mensagem pronta para o WhatsApp do administrador, com o e-mail da conta
 * autenticada. O e-mail vem do parâmetro (sessão do Supabase), nunca de um
 * campo que o cliente possa editar para pedir o benefício em outra conta.
 */
export function trialRequestMessage(email: string | null | undefined, name?: string | null): string {
  const quem = name ? `${name} (${email ?? 'e-mail não informado'})` : (email ?? 'e-mail não informado')
  return `Olá! Quero o mês grátis do MovieFlix. Minha conta: ${quem}. Pode me enviar o código? Obrigado!`
}
