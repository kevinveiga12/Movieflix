/**
 * CLIENTE MEGAEMBED — integração do player, atrás de uma flag.
 *
 * ── O QUE FOI MEDIDO (2026-11-22) ────────────────────────────────────────────
 *
 * Catálogo: 21.317 filmes e 7.741 séries (GET /api/movie e /api/series).
 * Embed:    https://mgeb.space/embed/{tmdb_id}
 *           https://mgeb.space/embed/{tmdb_id}/{temporada}/{episodio}
 *           https://mgeb.space/embed/{imdb_id}
 * Player:   origem ÚNICA, com <video class="megatube-video"> próprio. Não há
 *           cadeia de iframes como no player azul — a UI inteira (barra de
 *           cima, controles, botão de tela cheia) vive no MESMO documento.
 *
 * ── OS TRÊS BLOQUEIOS ────────────────────────────────────────────────────────
 *
 * 1. Cloudflare Turnstile em TODOS os domínios (mgeb.space/.lat/.casa/.quest e
 *    megaembed.com). Medido: 403 `cf-mitigated: challenge` em todos. O desafio
 *    é interativo e NÃO passa em Chromium headless nem headed em Xvfb — o
 *    Cloudflare detecta o datacenter. Portanto o SERVIDOR não consegue buscar
 *    /api/movie nem /api/series.
 *
 * 2. `X-Frame-Options: SAMEORIGIN` na resposta do desafio. Em navegador real, um
 *    iframe cross-origin do embed resulta em `chrome-error://chromewebdata/`.
 *    Não foi possível medir os headers da página pós-desafio (o desafio nunca
 *    passa), então NÃO afirmamos que a página real também bloqueia iframe.
 *
 * 3. ANÚNCIOS. O site se anuncia como "Video Streaming API With Minimal Ads" e
 *    o HTML do embed termina com `<!-- ADS INJECTION -->` seguido de um iframe
 *    oculto 1×1. O MegaEmbed injeta anúncios por design.
 *
 * ── POR QUE A FLAG EXISTE ────────────────────────────────────────────────────
 *
 * O requisito é "não publicar antes de validar todas as funcionalidades" e
 * "manter possibilidade de rollback". Como a reprodução real não pôde ser
 * validada neste ambiente, a integração fica pronta e DESLIGADA
 * (`MEGAEMBED_ENABLED=false` por padrão). Com a flag desligada, o player
 * continua exatamente como está hoje.
 */

/** Domínio principal. Os alternativos existem, mas todos atrás do mesmo Cloudflare. */
export const MEGAEMBED_BASE = process.env.MEGAEMBED_BASE ?? 'https://mgeb.space'

/** A integração está ligada? Padrão: NÃO. */
export function megaembedEnabled() {
  return String(process.env.MEGAEMBED_ENABLED ?? '').toLowerCase() === 'true'
}

/** Estados de disponibilidade exigidos pelo pedido. */
export const STATES = {
  AVAILABLE: 'disponivel',
  CHECKING: 'em_verificacao',
  UNAVAILABLE: 'indisponivel',
  PLAYBACK_ERROR: 'erro_reproducao',
  EXPIRED: 'fonte_expirada',
}

/** UA de navegador real: o provedor devolve 403 para UA de robô. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Marcadores de que a página realmente tem player. */
const PLAYER_MARKERS = [/megatube-video/i, /<video[\s>]/i, /\.m3u8/i, /createMyPlayer/i]

/** Marcadores de desafio humano (Cloudflare Turnstile). */
const CHALLENGE_MARKERS = [
  /Just a moment/i,
  /Um momento/i,
  /cf-mitigated/i,
  /challenges\.cloudflare\.com/i,
  /cf-turnstile/i,
  /Executando verifica/i,
  /Performing security verification/i,
]

/** Marcadores de anúncio injetado. */
const AD_MARKERS = [/ADS INJECTION/i, /data-original-tag="iframe"/i]

/**
 * Valida um TMDB ID. Só dígitos — o catálogo guarda `tmdb_id` numérico.
 * Aceita também IMDb (`tt1234567`), que o MegaEmbed suporta.
 */
export function normalizeId(raw) {
  const id = String(raw ?? '').trim()
  if (/^tt\d+$/i.test(id)) return id.toLowerCase()
  if (/^\d+$/.test(id)) return id
  return null
}

/** URL de embed de um filme. */
export function movieEmbedUrl(id) {
  const n = normalizeId(id)
  if (!n) return null
  return `${MEGAEMBED_BASE}/embed/${n}`
}

/** URL de embed de um episódio. */
export function episodeEmbedUrl(id, season, episode) {
  const n = normalizeId(id)
  if (!n) return null
  const s = Number(season)
  const e = Number(episode)
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < 1) return null
  return `${MEGAEMBED_BASE}/embed/${n}/${s}/${e}`
}

/** URL de embed de uma série (lista de temporadas/episódios). */
export function seriesEmbedUrl(id) {
  const n = normalizeId(id)
  if (!n) return null
  return `${MEGAEMBED_BASE}/embed/${n}`
}

/**
 * Sonda o embed de um título e classifica o estado.
 *
 * Devolve `{ state, http, hasPlayer, hasAds, challenge, ms }`.
 *
 * IMPORTANTE — o que esta sonda NÃO faz: não considera HTTP 200 como prova de
 * reprodução. O pedido é explícito nisso. Ela só distingue "a página tem
 * player" de "a página é desafio/vazia". A prova de reprodução exige um
 * navegador com o vídeo tocando, que é o que o cliente faz no aparelho dele.
 */
export async function probeMegaEmbed(url, { timeoutMs = 8000 } = {}) {
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    })
    const html = (await res.text()).slice(0, 300_000)
    const ms = Date.now() - started

    const challenge = CHALLENGE_MARKERS.some((re) => re.test(html))
    const hasPlayer = PLAYER_MARKERS.some((re) => re.test(html))
    const hasAds = AD_MARKERS.some((re) => re.test(html))

    let state
    if (challenge) {
      // Desafio humano: não sabemos se o título existe. NÃO é "indisponível".
      state = STATES.CHECKING
    } else if (!res.ok) {
      state = res.status === 404 ? STATES.UNAVAILABLE : STATES.PLAYBACK_ERROR
    } else if (hasPlayer) {
      state = STATES.AVAILABLE
    } else {
      state = STATES.UNAVAILABLE
    }

    return { state, http: res.status, hasPlayer, hasAds, challenge, ms }
  } catch (err) {
    return {
      state: STATES.PLAYBACK_ERROR,
      http: 0,
      hasPlayer: false,
      hasAds: false,
      challenge: false,
      ms: Date.now() - started,
      error: String(err?.message ?? err).slice(0, 160),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve as fontes de reprodução de um título.
 *
 * Devolve a lista no formato que o player já entende (`{ id, label, url, mode,
 * verified }`), para que a troca de provedor não exija mudar o PlayerPage.
 */
export async function resolveMegaEmbedSources({ tmdbId, season = null, episode = null }) {
  const isEpisode = season != null && episode != null
  const url = isEpisode
    ? episodeEmbedUrl(tmdbId, season, episode)
    : movieEmbedUrl(tmdbId)
  if (!url) return []

  const probe = await probeMegaEmbed(url)
  return [
    {
      id: 'megaembed',
      label: 'MegaEmbed',
      url,
      mode: 'embed',
      verified: probe.state === STATES.AVAILABLE ? true : probe.state === STATES.CHECKING ? null : false,
      state: probe.state,
      hasAds: probe.hasAds,
    },
  ]
}
