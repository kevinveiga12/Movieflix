import { supabase } from './supabase'
import type { Plan, Subscription, PlaybackAuth, DbSeason, Title, PixCharge, CardCharge } from './types'

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
}): Promise<PixCharge> {
  const headers = await authHeader()
  return getJson<PixCharge>('/api/payments/pix', {
    method: 'POST',
    headers,
    body: JSON.stringify({ plan_code: args.planCode, period: args.period }),
  })
}

/** Status de um pagamento — a tela usa em polling até aprovar ou expirar. */
export async function fetchPaymentStatus(paymentId: string): Promise<PixCharge> {
  const headers = await authHeader()
  return getJson<PixCharge>(`/api/payments/${encodeURIComponent(paymentId)}/status`, { headers })
}

/** O Pix está disponível neste servidor? (MP_ACCESS_TOKEN configurado) */
export async function fetchPixConfig(): Promise<{
  pix_enabled: boolean
  card_enabled?: boolean
  /** Por que o cartão está desligado: 'missing_access_token' | 'missing_public_key'. */
  card_reason?: string | null
  public_key?: string | null
  mode: string
}> {
  try {
    return await getJson('/api/payments/config')
  } catch {
    return { pix_enabled: false, card_enabled: false, public_key: null, mode: 'unconfigured' }
  }
}

/**
 * Tokeniza o cartão DIRETO no Mercado Pago.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO ACONTECE NO NAVEGADOR E NÃO NO NOSSO SERVIDOR
 * ══════════════════════════════════════════════════════════════════════════════
 * O número do cartão, o CVV e a validade NUNCA passam pelo backend do MovieFlix.
 * Esta função fala com `api.mercadopago.com/v1/card_tokens` usando a chave
 * PÚBLICA, e o que volta é um `token` de uso único — um identificador que não
 * permite reconstruir o cartão e expira em minutos.
 *
 * É o caminho oficial do Mercado Pago para Checkout Transparente. Mandar o PAN
 * para o nosso servidor seria violar o pedido e o PCI-DSS.
 *
 * Nada aqui é gravado: nem em localStorage, nem em estado global, nem em log.
 * O objeto do cartão existe só na memória do formulário até virar token.
 */
export async function tokenizeCard(args: {
  publicKey: string
  cardNumber: string
  expirationMonth: string
  expirationYear: string
  securityCode: string
  cardholderName: string
  identificationType?: string
  identificationNumber?: string
}): Promise<{ token: string; paymentMethodId: string | null; issuerId: string | null; last4: string | null }> {
  const body = {
    card_number: args.cardNumber.replace(/\s+/g, ''),
    expiration_month: Number(args.expirationMonth),
    expiration_year: Number(args.expirationYear),
    security_code: args.securityCode,
    cardholder: {
      name: args.cardholderName,
      ...(args.identificationNumber
        ? {
            identification: {
              type: args.identificationType ?? 'CPF',
              number: args.identificationNumber,
            },
          }
        : {}),
    },
  }

  const res = await fetch(
    `https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(args.publicKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )

  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.id) {
    // A mensagem do provedor é técnica; a tela mostra a nossa.
    throw new Error('Não foi possível validar o cartão. Confira os dados e tente de novo.')
  }

  return {
    token: String(data.id),
    paymentMethodId: data.payment_method?.id ?? null,
    issuerId: data.issuer?.id ? String(data.issuer.id) : null,
    last4: data.last_four_digits ?? null,
  }
}

/**
 * Envia o TOKEN do cartão ao nosso servidor para cobrar.
 *
 * O corpo tem apenas o token e a bandeira — nenhum dado do cartão. O valor é
 * resolvido no servidor, como no Pix.
 */
export async function createCardCharge(args: {
  planCode: string
  period: string
  token: string
  paymentMethodId: string
  issuerId?: string | null
}): Promise<CardCharge> {
  const headers = await authHeader()
  return getJson<CardCharge>('/api/payments/card', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      plan_code: args.planCode,
      period: args.period,
      token: args.token,
      payment_method_id: args.paymentMethodId,
      issuer_id: args.issuerId ?? undefined,
    }),
  })
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
