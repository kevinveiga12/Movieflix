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
  /**
   * CDNs do `embedplayer2.xyz` (medidos em 2026-11-23, amostra de 5 títulos).
   *
   * O `embedplayer` era tratado como "embed com anúncio" e ficava desligado.
   * Mas o anúncio mora no IFRAME dele, não no CDN do vídeo: o endpoint
   * `POST /player/index.php?data={hash}&do=getVideo` devolve o `securedLink`
   * do HLS, e esse m3u8 toca no NOSSO <video> sem carregar nada do iframe.
   *
   * Os hosts giram por família (`eloialu6`…`eloialu10`), então a regra é por
   * sufixo de domínio, não por host exato. Todos são servidores de vídeo do
   * mesmo provedor — nenhum é host interno, então o allowlist continua fechado
   * contra SSRF.
   */
  /(^|\.)cincloud\d*\.xyz$/i,
  /(^|\.)playcine\d*\.xyz$/i,
  /(^|\.)playclou\d*s?\.xyz$/i,
  /(^|\.)vipcine\d*\.xyz$/i,
  /(^|\.)playersl\.xyz$/i,
  /(^|\.)eloialu\d*\.xyz$/i,
  /(^|\.)embedplayer2\.xyz$/i,
]

/** O stream só é servido para estes Referers (os do próprio provedor). */
const STREAM_REFERERS = [
  'https://v2.watchplay.shop/',
  'https://v1.watchplay.shop/',
  'https://playerflix.ink/',
  'https://myembed.biz/',
  // CDNs do embedplayer: o Referer que eles aceitam é o do próprio player.
  'https://embedplayer2.xyz/',
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
 * DISJUNTOR do `playerflix.ink`.
 *
 * Medido em produção: quando o host está bloqueado, cada chamada a
 * `fetchOptions` gasta ~6 s até estourar o timeout. Sem disjuntor, abrir um
 * título custaria 6 s de espera ANTES de tentar a convenção — e o cliente
 * veria o spinner parado.
 *
 * Depois de `BREAKER_THRESHOLD` falhas seguidas, o Ajax é pulado por
 * `BREAKER_COOLDOWN_MS` e o resolvedor vai direto à convenção. Uma única
 * resposta boa zera o contador, então quando o host volta o caminho completo
 * volta sozinho.
 */
const BREAKER_THRESHOLD = 3
const BREAKER_COOLDOWN_MS = 5 * 60_000
let breakerFails = 0
let breakerOpenUntil = 0

function breakerOpen() {
  return Date.now() < breakerOpenUntil
}

function breakerRecord(ok) {
  if (ok) {
    breakerFails = 0
    breakerOpenUntil = 0
    return
  }
  breakerFails += 1
  if (breakerFails >= BREAKER_THRESHOLD) breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS
}

/**
 * Estado do disjuntor do host do Ajax — para o painel e para os testes.
 *
 * Antes este estado era invisível: descobrir que o `playerflix.ink` estava
 * bloqueado exigiu medir de dentro do pod. Com isto, `/api/playback/diagnostics`
 * responde na hora, e o teste de regressão consegue provar que um host
 * inalcançável abre o disjuntor (e que um título ausente NÃO abre).
 */
export function ajaxBreakerStatus() {
  return {
    fails: breakerFails,
    open: Date.now() < breakerOpenUntil,
    retryInMs: Math.max(0, breakerOpenUntil - Date.now()),
  }
}

/**
 * Pede ao `playerflix.ink` a lista de opções de reprodução do título.
 *
 * Devolve `[{ embed, label, id }]` ou `[]`. Nunca lança: qualquer falha vira
 * lista vazia, e quem chama cai no modo embed.
 */
export async function fetchOptions({ tmdbId, season, episode, timeoutMs = 6000 }) {
  const { options } = await fetchOptionsDetailed({ tmdbId, season, episode, timeoutMs })
  return options
}

/**
 * Igual a `fetchOptions`, mas diz se o host estava ALCANÇÁVEL.
 *
 * `reachable: false` só quando a requisição falhou de verdade (rede, timeout,
 * 5xx). Um `{"status":false}` — título que o Ajax não indexa — é
 * `reachable: true` com lista vazia: o host respondeu, apenas não tem o título.
 * É essa distinção que impede o disjuntor de abrir por causa de títulos
 * ausentes (bug de 2026-11-23).
 */
export async function fetchOptionsDetailed({ tmdbId, season, episode, timeoutMs = 6000 }) {
  // Host sabidamente fora: não gasta o timeout de novo.
  if (breakerOpen()) return { options: [], reachable: false }

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
    if (!res.ok) {
      // 5xx = host com problema. 4xx = host respondeu; não é falha dele.
      const reachable = res.status < 500
      breakerRecord(reachable)
      return { options: [], reachable }
    }
    const json = await res.json()
    const options = json?.data?.options
    if (!Array.isArray(options)) {
      /**
       * `{"status":false}` = o Ajax RESPONDEU e não indexa este título. É falha
       * do TÍTULO, não do host — penalizar aqui abria o disjuntor com três
       * títulos ausentes e derrubava o caminho que funciona para todo mundo.
       */
      breakerRecord(true)
      return { options: [], reachable: true }
    }
    breakerRecord(true)
    return {
      reachable: true,
      options: options
        .filter((o) => typeof o?.embed === 'string' && /^https:\/\//.test(o.embed))
        .map((o) => ({
          embed: o.embed,
          label: o.label ?? '',
          id: o.id ?? '',
          // `budget` é o sinal de fonte do provedor: "success" = tem vídeo,
          // "danger" = só o plano pago, ou seja, NÃO reproduz.
          budget: String(o?.budget ?? ''),
        })),
    }
  } catch {
    breakerRecord(false)
    return { options: [], reachable: false }
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

    /**
     * 404/410 = o provedor RESPONDEU e não tem este título. É falha do TÍTULO,
     * não do provedor: `reachable: true`. Só 5xx (e erro de rede) contam como
     * provedor fora do ar.
     */
    if (res.status === 404 || res.status === 410) return { url: null, reachable: true }
    if (!res.ok) return { url: null, reachable: res.status < 500 }

    const html = await res.text()

    // `url:"https:\/\/host\/...\/playlist.m3u8?md5=...&expires=..."`
    const m = html.match(/url\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i)
    // Página 200 sem m3u8: o provedor está no ar, só não tem fonte para este
    // título. Continua sendo falha do título.
    if (!m) return { url: null, reachable: true }

    const url = m[1].replace(/\\\//g, '/')
    if (!/^https:\/\//.test(url)) return { url: null, reachable: true }
    if (!isAllowedStreamHost(url)) return { url: null, reachable: true }
    return { url, reachable: true }
  } catch {
    // Timeout / DNS / conexão derrubada: aqui SIM o provedor está inalcançável.
    return { url: null, reachable: false }
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
/**
 * URL do player de verdade montada por CONVENÇÃO, sem passar pelo
 * `playerflix.ink`.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 *
 * `fetchOptions` pergunta a lista de opções ao `playerflix.ink`. Medido em
 * produção (2026-11-23): o pod da Velixir NÃO alcança esse host —
 * `GET https://playerflix.ink/inc/Ajax.php?...` pelo nosso próprio proxy
 * devolve conexão derrubada (HTTP 000, ~7 s), enquanto
 * `https://v1.watchplay.shop/movie/550` responde 200 em 1,7 s pelo mesmo
 * caminho. Ou seja: o bloqueio é do host do Ajax, não da rede do pod.
 *
 * Com `fetchOptions` devolvendo `[]`, o resolvedor desistia e TODO título caía
 * no MegaEmbed — que responde a tela "Nenhuma fonte de reprodução funcional
 * disponível". Era isso que o cliente via na maioria do catálogo.
 *
 * A convenção de URL do `watchplay` é estável e foi medida:
 *
 *     filme    → https://v1.watchplay.shop/movie/{tmdb}
 *     episódio → https://v1.watchplay.shop/tvshow/{tmdb}/{temporada}/{episódio}
 *
 * Um id que não existe ali responde 404 — então tentar por convenção nunca
 * inventa um título: ou o player devolve o m3u8, ou não devolve nada.
 */
function conventionEmbedUrl({ tmdbId, season, episode }) {
  const isEpisode = season != null && episode != null
  return isEpisode
    ? `https://v1.watchplay.shop/tvshow/${tmdbId}/${season}/${episode}`
    : `https://v1.watchplay.shop/movie/${tmdbId}`
}

/**
 * Resolve o stream direto E diz se o provedor estava ALCANÇÁVEL.
 *
 * ── POR QUE ISTO EXISTE (bug de 2026-11-23) ─────────────────────────────────
 *
 * `resolveDirectStream` devolvia `null` em dois casos MUITO diferentes:
 *
 *   a) o provedor está fora do ar / bloqueado  → falha DELE, vale abrir o
 *      disjuntor;
 *   b) o título simplesmente não existe lá (404) → falha DO TÍTULO, o provedor
 *      está ótimo.
 *
 * O `playback-chain` tratava os dois como (a) e chamava `record('watchplay',
 * false)`. Resultado medido: bastavam TRÊS títulos sem fonte — e o catálogo tem
 * milhares — para o disjuntor abrir e o `watchplay` ser PULADO por 5 minutos em
 * TODOS os títulos, inclusive nos que funcionam. Era essa a "falha generalizada":
 * o cliente abria um filme que existe, o resolvedor nem tentava, e caía no
 * MegaEmbed, que responde "Nenhuma fonte de reprodução funcional disponível".
 *
 * Agora o chamador sabe a diferença: `reachable: false` só quando a requisição
 * ao provedor falhou de verdade (rede, timeout, 5xx). Um 404 é `reachable: true`
 * com `stream: null` — o provedor respondeu, apenas não tem o título.
 */
export async function resolveDirectStreamDetailed({ tmdbId, season = null, episode = null }) {
  const id = String(tmdbId ?? '').trim()
  if (!/^\d+$/.test(id)) return { stream: null, reachable: true }

  const key = `${id}:${season ?? ''}:${episode ?? ''}`
  const cached = cacheGet(key)
  if (cached) return { stream: cached, reachable: true }

  /**
   * Timeout curto de propósito: existe a convenção como plano B, então não
   * vale segurar o cliente 6 s esperando um host que pode estar bloqueado.
   * Quando o Ajax responde, ele responde em ~300 ms.
   */
  const options = await fetchOptions({ tmdbId: id, season, episode, timeoutMs: 2500 })

  /**
   * Sem lista de opções (host do Ajax inalcançável, ou título que ele não
   * indexa), tenta a convenção direta antes de desistir. É o caminho que
   * devolve o catálogo ao ar quando o `playerflix.ink` está bloqueado.
   */
  if (!options.length) {
    const r = await extractStreamUrl(conventionEmbedUrl({ tmdbId: id, season, episode }))
    if (!r.url) return { stream: null, reachable: r.reachable }
    const value = { url: r.url, referer: 'https://v2.watchplay.shop/', label: 'Servidor principal' }
    cacheSet(key, value)
    return { stream: value, reachable: true }
  }

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

  // `watchplay` primeiro: é o player de verdade, com HLS e sem UI de cima.
  const ordered = [
    ...usable.filter((o) => o.id === 'watchplay'),
    ...usable.filter((o) => o.id !== 'watchplay'),
  ]

  let anyReachable = false
  for (const opt of ordered) {
    const r = await extractStreamUrl(opt.embed)
    if (r.reachable) anyReachable = true
    if (!r.url) continue
    const value = { url: r.url, referer: 'https://v2.watchplay.shop/', label: opt.label || 'Servidor principal' }
    cacheSet(key, value)
    return { stream: value, reachable: true }
  }

  /**
   * Última tentativa: a convenção do `watchplay`.
   *
   * Cobre o caso em que a lista veio só com `danger` (o Ajax indexa o título
   * mas não aponta fonte paga) e o caso em que as opções listadas não
   * entregaram m3u8. Se o id não existir no `watchplay`, isto devolve 404 e
   * o resultado continua `null` — nunca inventa fonte.
   */
  const fallback = await extractStreamUrl(conventionEmbedUrl({ tmdbId: id, season, episode }))
  if (!fallback.url) return { stream: null, reachable: anyReachable || fallback.reachable }
  const value = { url: fallback.url, referer: 'https://v2.watchplay.shop/', label: 'Servidor principal' }
  cacheSet(key, value)
  return { stream: value, reachable: true }
}

/**
 * Compatibilidade: a assinatura antiga devolvia só o stream (ou `null`).
 *
 * Os scripts de teste (`scripts/test-stream-*.mjs`) e qualquer chamador que só
 * queira a URL continuam funcionando. O `playback-chain` usa a versão
 * `Detailed`, que é a que sabe distinguir "provedor fora" de "título ausente".
 */
export async function resolveDirectStream({ tmdbId, season = null, episode = null }) {
  const { stream } = await resolveDirectStreamDetailed({ tmdbId, season, episode })
  return stream
}

/**
 * TERCEIRA CAMADA — HLS DIRETO DO `embedplayer`, SEM O IFRAME DELE.
 *
 * ── O QUE MUDOU DE ENTENDIMENTO ─────────────────────────────────────────────
 *
 * O `embedplayer2.xyz` estava classificado como "embed com anúncio" e ficava
 * desligado atrás de `ALLOW_AD_EMBEDS`. Isso estava certo sobre o IFRAME e
 * errado sobre a FONTE.
 *
 * Medido em 2026-11-23: o player dele expõe o HLS cru por um endpoint próprio:
 *
 *     POST /player/index.php?data={hash}&do=getVideo
 *     body: hash={hash}&r={referer}
 *     → { hls: true, securedLink: "https://.../master.m3u8?md5=...&expires=..." }
 *
 * O `master.m3u8` responde `#EXTM3U`, a variante responde `#EXTM3U` e o
 * primeiro segmento vem com magic bytes de vídeo (MPEG-TS `0x47` ou fMP4
 * `styp`). Ou seja: é vídeo de verdade, servido por CDN.
 *
 * Os trackers (`tracker.Royale.com`, `tracker.advertising.com`) e o
 * `poplimit:false` estão no HTML do IFRAME — não no CDN. Tocando o m3u8 no
 * NOSSO `<video>`, nada daquele HTML é carregado: sem anúncio, sem pop-up,
 * sem aba nova. É a mesma lógica que já usamos com o `watchplay`.
 *
 * ── COBERTURA MEDIDA (amostra distribuída, 2026-11-23) ──────────────────────
 *
 *   filmes: 6/20 = 30%   (9 não têm embedplayer, 4 com master 404)
 *   séries: 3/12 = 25%   (era 0% — o watchplay não tem essas séries)
 *
 * É a maior fonte nova de séries que já medimos. Por isso entra na cadeia
 * ANTES do embed de terceiro, e DEPOIS do watchplay (que é mais estável).
 *
 * ── O QUE ESTA FUNÇÃO NÃO FAZ ───────────────────────────────────────────────
 *
 * Não carrega o iframe, não executa o JS dele, não segue `downloadLinks`.
 * Só faz o POST do `getVideo` e devolve a URL do m3u8. Se o provedor mudar o
 * endpoint, isto devolve `null` e a cadeia segue para o próximo candidato.
 */
const EMBEDPLAYER_ORIGIN = 'https://embedplayer2.xyz'

/** Cache curto do hash → m3u8. O link carrega `expires`, então é curto. */
const embedPlayerCache = new Map()
const EP_TTL_MS = 6 * 60_000

/**
 * Resolve o HLS do `embedplayer` a partir do hash do vídeo.
 *
 * Devolve `{ url, referer, label }` ou `null`. Nunca lança.
 */
export async function resolveEmbedPlayerStream({ hash, timeoutMs = 9000 }) {
  const h = String(hash ?? '').trim()
  if (!/^[a-f0-9]{16,64}$/i.test(h)) return null

  const hit = embedPlayerCache.get(h)
  if (hit && Date.now() - hit.at < EP_TTL_MS) return hit.value

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${EMBEDPLAYER_ORIGIN}/player/index.php?data=${h}&do=getVideo`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Referer: `${EMBEDPLAYER_ORIGIN}/video/${h}`,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `hash=${h}&r=${encodeURIComponent(PLAYERFLIX_REFERER)}`,
    })
    if (!res.ok) return null

    const json = await res.json().catch(() => null)
    const link = typeof json?.securedLink === 'string' ? json.securedLink : null
    if (!link || !/^https:\/\//.test(link)) return null
    if (!isAllowedStreamHost(link)) return null

    const value = { url: link, referer: `${EMBEDPLAYER_ORIGIN}/`, label: 'Servidor alternativo' }
    if (embedPlayerCache.size > 200) embedPlayerCache.clear()
    embedPlayerCache.set(h, { at: Date.now(), value })
    return value
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
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
