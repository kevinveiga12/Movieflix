/**
 * RESOLVEDOR DE STREAM DIRETO — a correção da tela cheia.
 *
 * ── O PROBLEMA QUE ISTO RESOLVE ─────────────────────────────────────────────
 *
 * O player azul (myembed.biz) NÃO é um player: é um encadeamento de três
 * iframes de origens diferentes.
 *
 *     myembed.biz/filme/{id}
 *        └─ playerflix.ink/filme/{id}      ← desenha a BARRA DE CIMA
 *             └─ v1.watchplay.shop/movie/{id}   ← o player de verdade
 *                  └─ <video> + HLS
 *
 * A barra de cima que o cliente vê em tela cheia (título, "ASSISTIR DUB •
 * WatchPlay", engrenagem, aviso, tela cheia) é HTML do `playerflix.ink`.
 * Medido em navegador real: ela NUNCA se esconde — nem depois de 15 s parado,
 * nem em tela cheia (`display:flex`, `opacity:1` em todas as amostras). E não
 * existe parâmetro de URL que a desligue: testados `?embed=1`, `?ui=0`,
 * `?clean=1`, `?controls=0` — a barra aparece nos quatro.
 *
 * Nosso CSS não alcança o interior de um iframe de outra origem. Portanto
 * esconder aquela barra por CSS é impossível, e a tela cheia do provedor
 * também não resolve: ela entra em fullscreen e a barra continua lá.
 *
 * ── A SOLUÇÃO ───────────────────────────────────────────────────────────────
 *
 * O `v1.watchplay.shop` (o player de verdade) publica a URL do stream no
 * próprio HTML, dentro de `createMyPlayer({ url: "..." })`. Se tocarmos esse
 * HLS num `<video>` NOSSO, não existe barra de provedor nenhuma: só o vídeo,
 * a nossa barra e a tela cheia nativa do navegador (que funciona de verdade).
 *
 * O stream exige `Referer: https://v2.watchplay.shop/` e responde
 * `Access-Control-Allow-Origin: https://v2.watchplay.shop` — ou seja, o
 * navegador do cliente NÃO pode buscá-lo direto (CORS). Por isso o servidor
 * faz o proxy (`/api/stream`), que também resolve o Referer.
 *
 * ── O QUE ISTO NÃO FAZ ──────────────────────────────────────────────────────
 *
 * Não baixa, não guarda e não redistribui mídia: repassa byte a byte, com o
 * Referer que o provedor exige, exatamente como o iframe dele faria. Se a
 * resolução falhar (título sem opção, provedor fora do ar, Cloudflare), quem
 * chama cai no modo embed de sempre — o player nunca fica sem caminho.
 */

/** UA de navegador real: os provedores devolvem 403 para UA de robô. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** De onde o `playerflix.ink` tira a lista de opções de reprodução. */
const AJAX = 'https://playerflix.ink/inc/Ajax.php'

/** Referer que o `playerflix.ink` usa ao pedir as opções. */
const PLAYERFLIX_REFERER = 'https://playerflix.ink/'

/**
 * Hosts cujo stream podemos repassar.
 *
 * Allowlist fechada de propósito: o proxy recebe uma URL na query string e,
 * sem isto, viraria um proxy aberto (SSRF) — qualquer um poderia pedir
 * `?u=http://169.254.169.254/...` e ler a rede interna. Só os CDNs de vídeo
 * que o provedor realmente usa entram aqui.
 */
const STREAM_HOSTS = [
  /(^|\.)hclod\.qzz\.io$/i,
  /(^|\.)watchplay\.shop$/i,
  /(^|\.)superflixapi\.boats$/i,
  /(^|\.)abyssplayer\.com$/i,
  /(^|\.)myembed\.biz$/i,
  /(^|\.)playerflix\.ink$/i,
]

/** O stream só é servido para estes Referers (os do próprio provedor). */
const STREAM_REFERERS = [
  'https://v2.watchplay.shop/',
  'https://v1.watchplay.shop/',
  'https://playerflix.ink/',
  'https://myembed.biz/',
]

export function isAllowedStreamHost(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    return STREAM_HOSTS.some((re) => re.test(u.hostname))
  } catch {
    return false
  }
}

export function isAllowedReferer(ref) {
  return STREAM_REFERERS.includes(ref)
}

/** Cache curto: a URL do m3u8 carrega `expires`, então não vale guardar muito. */
const cache = new Map()
const TTL_MS = 8 * 60_000
const CAP = 300

function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.value
}

function cacheSet(key, value) {
  if (cache.size >= CAP) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), value })
}

/**
 * Pede ao `playerflix.ink` a lista de opções de reprodução do título.
 *
 * Devolve `[{ embed, label, id }]` ou `[]`. Nunca lança: qualquer falha vira
 * lista vazia, e quem chama cai no modo embed.
 */
export async function fetchOptions({ tmdbId, season, episode, timeoutMs = 6000 }) {
  const isEpisode = season != null && episode != null
  const qs = new URLSearchParams({
    type: isEpisode ? 'tv' : 'movie',
    id: String(tmdbId),
    season: isEpisode ? String(season) : 'null',
    episode: isEpisode ? String(episode) : 'null',
  })

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${AJAX}?${qs}`, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Referer: PLAYERFLIX_REFERER,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
    })
    if (!res.ok) return []
    const json = await res.json()
    const options = json?.data?.options
    if (!Array.isArray(options)) return []
    return options
      .filter((o) => typeof o?.embed === 'string' && /^https:\/\//.test(o.embed))
      .map((o) => ({
        embed: o.embed,
        label: o.label ?? '',
        id: o.id ?? '',
        // `budget` é o sinal de fonte do provedor: "success" = tem vídeo,
        // "danger" = só o plano pago, ou seja, NÃO reproduz.
        budget: String(o?.budget ?? ''),
      }))
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Busca a página do player de verdade e extrai a URL do stream.
 *
 * O HTML traz `createMyPlayer({ ..., url:"https:\/\/...\/playlist.m3u8?..." })`.
 * As barras vêm escapadas (`\/`), então desescapamos antes de usar.
 */
async function extractStreamUrl(embedUrl, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(embedUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Referer: PLAYERFLIX_REFERER,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    })
    if (!res.ok) return null
    const html = await res.text()

    // `url:"https:\/\/host\/...\/playlist.m3u8?md5=...&expires=..."`
    const m = html.match(/url\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i)
    if (!m) return null

    const url = m[1].replace(/\\\//g, '/')
    if (!/^https:\/\//.test(url)) return null
    if (!isAllowedStreamHost(url)) return null
    return url
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve o stream direto de um título.
 *
 * Tenta as opções na ordem em que o provedor as devolve, mas prioriza a
 * `watchplay` — é a que entrega HLS limpo, sem a barra de cima.
 *
 * Devolve `{ url, referer, label }` ou `null`.
 */
export async function resolveDirectStream({ tmdbId, season = null, episode = null }) {
  const id = String(tmdbId ?? '').trim()
  if (!/^\d+$/.test(id)) return null

  const key = `${id}:${season ?? ''}:${episode ?? ''}`
  const cached = cacheGet(key)
  if (cached) return cached

  const options = await fetchOptions({ tmdbId: id, season, episode })
  if (!options.length) return null

  /**
   * Só opções com fonte REAL. O provedor marca cada opção com `budget`:
   * `success` = tem vídeo, `danger` = só o plano pago.
   *
   * Antes daqui não havia esse filtro: o resolvedor tentava `danger` como se
   * fosse fonte, gastava o tempo de todas as sondas e, quando nada abria,
   * o cliente recebia o embed do MegaEmbed — que responde a tela "Todas as
   * fontes falharam". Filtrar aqui é o que faz um título sem fonte falhar
   * RÁPIDO e ser tratado como tal, em vez de virar erro no player.
   */
  const usable = options.filter((o) => o.budget !== 'danger')
  if (!usable.length) return null

  // `watchplay` primeiro: é o player de verdade, com HLS e sem UI de cima.
  const ordered = [
    ...usable.filter((o) => o.id === 'watchplay'),
    ...usable.filter((o) => o.id !== 'watchplay'),
  ]

  for (const opt of ordered) {
    const url = await extractStreamUrl(opt.embed)
    if (!url) continue
    const value = { url, referer: 'https://v2.watchplay.shop/', label: opt.label || 'Servidor principal' }
    cacheSet(key, value)
    return value
  }

  return null
}

/**
 * SEGUNDA CAMADA — embed do player de verdade, pulando o `playerflix.ink`.
 *
 * Quando o `watchplay` não está entre as opções (cerca de 1/4 do catálogo),
 * ainda existe um caminho melhor que o embed de sempre: incorporar
 * DIRETAMENTE a opção que o provedor aponta, sem a camada do
 * `playerflix.ink` no meio.
 *
 * É essa camada do meio que desenha a barra de cima (título, "ASSISTIR DUB",
 * engrenagem, tela cheia). Sem ela, o que sobra é o player de verdade — sem
 * UI de provedor. Neste caso não há UI de cima nenhuma para esconder, então a
 * nossa tela cheia (no `.player-stage`) já entrega só o vídeo.
 *
 * Só devolvemos opções que sabidamente renderizam sem a barra. O
 * `superflixapi` fica de fora: ele responde uma página de captcha Cloudflare
 * ("Confirme que você é humano") e não toca vídeo nem no navegador real.
 */
const CLEAN_EMBED_IDS = ['embedplay', 'embedplayer', 'watchplay']

export async function resolveCleanEmbed({ tmdbId, season = null, episode = null }) {
  const id = String(tmdbId ?? '').trim()
  if (!/^\d+$/.test(id)) return null

  const options = await fetchOptions({ tmdbId: id, season, episode })
  if (!options.length) return null

  // Embeds sem fonte (`budget: danger`) nunca são oferecidos: eles existem,
  // respondem 200, mas não têm vídeo — é exatamente o caso que o cliente
  // relatou como "Todas as fontes falharam".
  const clean = options.find((o) => CLEAN_EMBED_IDS.includes(o.id) && o.budget !== 'danger')
  if (!clean) return null

  return { id: clean.id, url: clean.embed, label: clean.label || 'Servidor principal' }
}

/**
 * Reescreve um playlist HLS para passar todo o tráfego pelo nosso proxy.
 *
 * O m3u8 do provedor usa URIs RELATIVAS (`0000.js`, `init.mp4`). Se o
 * navegador as resolvesse sozinho, pediria ao CDN do provedor — e o CORS
 * recusaria. Aqui cada URI vira uma URL absoluta do nosso `/api/stream`.
 */
export function rewritePlaylist(text, baseUrl, referer) {
  const base = new URL(baseUrl)
  const proxify = (uri) => {
    const abs = new URL(uri, base).toString()
    // A extensão no CAMINHO (não só na query) importa: o ffmpeg recusa
    // segmentos cuja URL não termina numa extensão conhecida, e alguns
    // players de TV fazem a mesma checagem. O nome é decorativo — quem manda
    // é `u` — mas precisa existir.
    const ext = /\.m3u8(\?|$)/i.test(abs) ? 'index.m3u8' : 'seg.mp4'
    return `/api/stream/${ext}?u=${encodeURIComponent(abs)}&r=${encodeURIComponent(referer)}`
  }

  return text
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (!t) return line
      // Diretivas com URI entre aspas: #EXT-X-MAP:URI="init.mp4"
      if (t.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxify(uri)}"`)
      }
      // Linha de URI de segmento/playlist.
      return proxify(t)
    })
    .join('\n')
}
