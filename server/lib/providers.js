/**
 * Provedores de reprodução — as "opções de servidor" do player.
 *
 * ── POR QUE ISTO EXISTE ──────────────────────────────────────────────────────
 *
 * O MovieFlix sempre dependeu de um provedor externo de embed. Em 2026-11-21 o
 * provedor principal (myembed.biz) passou a responder com uma página de
 * CLOAKING: um blog de investimentos falso, sem player nenhum. O cliente abria
 * o filme e via um site de FIIs no lugar do vídeo — e não havia para onde
 * trocar, porque o código só conhecia UM endereço.
 *
 * Aqui ficam TODAS as opções conhecidas, na ordem em que devem ser tentadas, e
 * uma verificação real (busca do HTML) que diz se aquela opção entrega um
 * player de verdade para o título pedido.
 *
 * ── O QUE A VERIFICAÇÃO FAZ E O QUE ELA NÃO FAZ ─────────────────────────────
 *
 * Ela busca a página do provedor com o mesmo Referer/UA que o navegador usaria
 * e procura marcadores de player (m3u8, <video>, artplayer, createMyPlayer).
 *
 *   true  → a página tem player. É a primeira a ser tentada.
 *   false → a página é cloaking, está vazia ou é uma tela de login. Não é
 *           oferecida como primeira opção.
 *   null  → não deu para saber (timeout, ou o provedor pede verificação
 *           humana). Continua na lista, depois das verificadas.
 *
 * Ela NÃO prova que o vídeo toca: isso depende do aparelho, da rede e do
 * próprio provedor. Por isso o cliente ainda tem o aviso "não está rodando" e o
 * botão de trocar servidor — a verificação só evita oferecer como primeira
 * opção algo que já sabidamente devolve página falsa.
 */

/** Marcadores de que a página realmente tem um player. */
const PLAYER_MARKERS = [
  /\.m3u8/i,
  /<video[\s>]/i,
  /artplayer/i,
  /createMyPlayer/i,
  /hls\.min\.js/i,
  /jwplayer/i,
  /videojs/i,
]

/**
 * Marcadores de cloaking / página que não é player.
 *
 * `Investidor.blog` é o blog falso que o myembed.biz passou a servir. Se a
 * página traz isso, não é player — por mais que responda HTTP 200.
 */
const CLOAK_MARKERS = [
  /Investidor\.blog/i,
  /FIIs, Ações e Educação Financeira/i,
]

/**
 * Marcadores de "precisa de verificação humana".
 *
 * O streambetter.shop (provedor padrão do catálogo) abre com uma tela do
 * Cloudflare Turnstile: "Confirmando que você é uma pessoa de verdade...".
 * Isso NÃO é falha — é o comportamento normal dele, e o vídeo carrega depois
 * que a pessoa passa pela verificação. Tratamos como `null` (desconhecido),
 * para a opção continuar disponível em vez de ser descartada.
 */
const CHALLENGE_MARKERS = [
  /Confirmando que voc[êe] é uma pessoa de verdade/i,
  /Verificando\.\.\./i,
  /Just a quick check/i,
  /cf-turnstile/i,
  /challenges\.cloudflare\.com/i,
]

/**
 * Opções de servidor, na ordem de preferência.
 *
 * `label` é o que o cliente vê ("Opção 1", "Opção 2"...). A ordem importa: o
 * player começa pela primeira que a verificação aprovou.
 */
export const PROVIDERS = [
  {
    id: 'myembed',
    label: 'Servidor principal',
    base: 'https://myembed.biz',
    movie: (id) => `/filme/${id}`,
    episode: (id, s, e) => `/serie/${id}/${s}/${e}`,
  },
  {
    id: 'playerflix',
    label: 'Opção 2',
    base: 'https://playerflix.ink',
    movie: (id) => `/filme/${id}`,
    episode: (id, s, e) => `/serie/${id}/${s}/${e}`,
  },
]

/** UA de navegador real: alguns provedores devolvem 403 para UA de robô. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Referer do próprio site — o provedor exige para liberar o embed. */
const REFERER = process.env.PUBLIC_SITE_URL ?? 'https://movieflix.velixir.run/'

/** Cache em memória: chave -> { at, ok }. TTL curto, o provedor muda de humor. */
const cache = new Map()
const TTL_MS = 10 * 60_000
const CACHE_CAP = 400

function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.ok
}

function cacheSet(key, ok) {
  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), ok })
}

/**
 * A página do provedor tem player de verdade?
 *
 * Devolve `true` / `false` / `null` (não sei). Em erro de rede devolve `null`,
 * que é diferente de "não funciona" — quem chama trata `null` como "tenta
 * mesmo assim", para não descartar uma opção boa por causa de um timeout.
 */
export async function probeProvider(url, { timeoutMs = 4500 } = {}) {
  const cached = cacheGet(url)
  if (cached !== null) return cached

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Referer: REFERER,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    })
    if (!res.ok) {
      cacheSet(url, false)
      return false
    }
    const html = (await res.text()).slice(0, 200_000)
    if (!html || html.length < 200) {
      // Corpo vazio: o provedor respondeu 200 sem servir nada.
      cacheSet(url, false)
      return false
    }
    if (CLOAK_MARKERS.some((re) => re.test(html))) {
      cacheSet(url, false)
      return false
    }
    if (CHALLENGE_MARKERS.some((re) => re.test(html))) {
      // Verificação humana: não sabemos, mas a opção é legítima.
      return null
    }
    const ok = PLAYER_MARKERS.some((re) => re.test(html))
    cacheSet(url, ok)
    return ok
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Monta a lista de opções para um título, já verificadas.
 *
 * `catalogUrl` é a URL que o admin cadastrou (o provedor padrão do catálogo).
 * Ela entra como PRIMEIRA candidata — é a escolha do dono do site — e as
 * demais entram como alternativas para a troca automática.
 *
 * Devolve SEMPRE todas as opções (o cliente precisa poder trocar mesmo que a
 * verificação tenha falhado por timeout), mas com `verified` preenchido e as
 * verificadas primeiro.
 */
export async function resolveSources({ tmdbId, season = null, episode = null, catalogUrl = null }) {
  const id = String(tmdbId ?? '').trim()
  if (!/^\d+$/.test(id)) return []

  const isEpisode = season != null && episode != null

  const candidates = []

  // 1) A URL do catálogo, quando é embed (a escolha do admin).
  if (catalogUrl && !/\.(mp4|m4v|webm|m3u8|mpd)(\?|#|$)/i.test(catalogUrl)) {
    candidates.push({ id: 'catalog', label: 'Servidor principal', url: catalogUrl })
  }

  // 2) Os provedores conhecidos, na ordem de preferência.
  for (const p of PROVIDERS) {
    const path = isEpisode ? p.episode?.(id, season, episode) : p.movie(id)
    if (!path) continue
    const url = `${p.base}${path}`
    if (candidates.some((c) => c.url === url)) continue
    candidates.push({ id: p.id, label: p.label, url })
  }

  if (!candidates.length) return []

  // Sonda todas em paralelo — poucas requisições curtas, não uma fila.
  const results = await Promise.all(
    candidates.map((c) => probeProvider(c.url).catch(() => null)),
  )

  const withFlag = candidates.map((c, i) => ({ ...c, verified: results[i] }))

  /**
   * Ordem final.
   *
   * O SERVIDOR PRINCIPAL (a URL que o admin cadastrou no catálogo) lidera —
   * é a escolha do dono do site e é o que os assinantes já conhecem. A única
   * exceção é quando a verificação provou que ele está quebrado
   * (`verified === false`, como o myembed.biz com a página de cloaking): aí
   * ele vai para o fim, para ninguém abrir o filme e cair num blog falso.
   *
   * Depois dele: as opções verificadas (true), as desconhecidas (null) e por
   * último as que sabidamente não têm player (false).
   */
  const rank = (c) => {
    if (c.id === 'catalog') return c.verified === false ? 3 : -1
    if (c.verified === true) return 0
    if (c.verified === null) return 1
    return 2
  }
  return withFlag.sort((a, b) => rank(a) - rank(b))
}

/** Só para o painel administrativo: estado atual de cada provedor. */
export function providerStatus() {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, base: p.base }))
}
