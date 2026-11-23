/**
 * CADEIA MULTIPROVEDOR — a decisão de "qual fonte tocar" em UM lugar.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O QUE ESTE MÓDULO RESOLVE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Antes, `server/routes/access.js` montava a lista de fontes à mão: tentava o
 * HLS direto, depois UM embed, e se nada desse mandava o MegaEmbed. O cliente
 * recebia uma lista de um item só — se aquela fonte falhasse no aparelho dele,
 * não havia para onde ir.
 *
 * Aqui a lista é montada como uma CADEIA ORDENADA de candidatos independentes.
 * O cliente começa no primeiro e, quando a reprodução falha DE VERDADE, pede o
 * próximo. A ordem é fixa e explicada:
 *
 *   1. `watchplay` (HLS direto)  → toca no NOSSO <video>: sem UI de provedor,
 *                                  sem anúncio, retomada exata, tela cheia real.
 *   2. `watchplay` (embed)       → o mesmo player, em iframe. Só entra quando o
 *                                  HLS não pôde ser extraído.
 *   3. `embedplay`               → iframe de terceiro. Tem anúncio; fica DEPOIS
 *                                  de tudo que é limpo, e só entra se o
 *                                  proprietário habilitar (`ALLOW_AD_EMBEDS`).
 *   4. `embedplayer`             → idem (trackers de anúncio medidos).
 *   5. `superflixapi`            → plano pago: o provedor marca `danger`, ou
 *                                  seja, NÃO reproduz. Nunca é oferecido.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O QUE FOI MEDIDO (2026-11-23, HTTP real, não "abriu a página")
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Filmes, 40 amostrados por passo fixo no catálogo:
 *     HLS limpo 15 · só embed 11 · só danger 13 · sem opção 1
 *   Séries, 30 amostradas com T1E1/T1E2:
 *     HLS limpo 3 · só embed 4 · só danger 23 · sem opção 0
 *
 * A convenção `/tvshow/{id}/{t}/{e}` do watchplay devolve 404 nas séries que o
 * Ajax marca `danger` — testado em 5 séries, 404 em todas. Ou seja: o provedor
 * realmente não tem essas séries. Não há código que resolva isso; inventar uma
 * fonte seria mentir para o cliente.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DISJUNTOR POR PROVEDOR
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Cada provedor tem o seu próprio contador. Um host fora do ar não pode
 * arrastar os outros: se o `playerflix.ink` (o Ajax) está bloqueado, o
 * `watchplay` continua sendo tentado por convenção. Antes havia UM disjuntor
 * global, então uma falha do Ajax desligava também o caminho que funcionava.
 */

import { resolveDirectStreamDetailed, resolveCleanEmbed, resolveEmbedPlayerStream, fetchOptions } from './stream-resolver.js'

/**
 * Provedores que podem abrir anúncio.
 *
 * Desligado por padrão. O proprietário pediu reprodução limpa; se algum dia
 * quiser trocar cobertura por anúncio, é uma variável de ambiente, não um
 * revert de commit.
 */
const ALLOW_AD_EMBEDS = process.env.ALLOW_AD_EMBEDS === '1'

/** Quantas falhas seguidas desligam um provedor, e por quanto tempo. */
const BREAKER_THRESHOLD = 3
const BREAKER_COOLDOWN_MS = 5 * 60_000

/**
 * Estado do disjuntor, um por provedor.
 *
 * `fails` zera a cada sucesso. `openUntil` é o instante em que o provedor volta
 * a ser tentado. Guardar por id (e não global) é o ponto: o `watchplay` não
 * pode ser penalizado por uma falha do `playerflix`.
 */
const breakers = new Map()

function breaker(id) {
  let b = breakers.get(id)
  if (!b) {
    b = { fails: 0, openUntil: 0 }
    breakers.set(id, b)
  }
  return b
}

function isOpen(id) {
  return Date.now() < breaker(id).openUntil
}

function record(id, ok) {
  const b = breaker(id)
  if (ok) {
    b.fails = 0
    b.openUntil = 0
    return
  }
  b.fails += 1
  if (b.fails >= BREAKER_THRESHOLD) b.openUntil = Date.now() + BREAKER_COOLDOWN_MS
}

/**
 * Histórico técnico das últimas decisões.
 *
 * Fica em memória (não vai para o banco do proprietário) e serve para o painel
 * responder "por que este título não abriu?". Guarda só o essencial: id do
 * título, provedor, resultado e motivo. Nada de token, nada de dado pessoal.
 */
const decisions = []
const DECISION_CAP = 300

function logDecision(entry) {
  decisions.unshift({ ...entry, at: new Date().toISOString() })
  if (decisions.length > DECISION_CAP) decisions.length = DECISION_CAP
}

/** Para o painel administrativo: últimas decisões de reprodução. */
export function recentPlaybackDecisions() {
  return decisions
}

/** Estado atual dos disjuntores — também para o painel. */
export function breakerStatus() {
  const out = {}
  for (const [id, b] of breakers) {
    out[id] = {
      fails: b.fails,
      open: Date.now() < b.openUntil,
      retryInMs: Math.max(0, b.openUntil - Date.now()),
    }
  }
  return out
}

/**
 * Monta a cadeia de fontes de um título.
 *
 * Devolve SEMPRE um array (possivelmente vazio). Cada item:
 *
 *   { id, label, url, mode: 'direct'|'embed', verified, provider }
 *
 * `url` no modo `direct` já vem pelo nosso proxy `/api/stream.m3u8`, porque o
 * CDN do provedor exige Referer e recusa CORS — o navegador não consegue buscar
 * direto.
 *
 * Nunca lança: qualquer falha de um provedor vira um item a menos na cadeia, e
 * o motivo fica registrado em `recentPlaybackDecisions()`.
 */
export async function resolvePlaybackChain({ tmdbId, season = null, episode = null }) {
  const id = String(tmdbId ?? '').trim()
  if (!/^\d+$/.test(id)) return []

  const isEpisode = season != null && episode != null
  const sources = []
  const tried = []

  // ── 1) HLS direto do watchplay ────────────────────────────────────────────
  // É o melhor caso e o único que entrega o player vermelho de verdade.
  if (!isOpen('watchplay')) {
    const r = await resolveDirectStreamDetailed({ tmdbId: id, season, episode }).catch(() => ({
      stream: null,
      reachable: false,
    }))
    if (r.stream) {
      record('watchplay', true)
      tried.push({ provider: 'watchplay', result: 'hls' })
      sources.push({
        id: 'direct',
        label: r.stream.label || 'Servidor principal',
        url: `/api/stream.m3u8?u=${encodeURIComponent(r.stream.url)}&r=${encodeURIComponent(r.stream.referer)}`,
        mode: 'direct',
        verified: true,
        provider: 'watchplay',
      })
    } else {
      /**
       * SÓ penaliza o provedor quando ele estava INALCANÇÁVEL.
       *
       * Um 404 (título que o provedor não tem) é falha do TÍTULO. Contá-lo como
       * falha do provedor abria o disjuntor com três títulos ausentes e passava
       * a PULAR o watchplay em todo o catálogo por 5 minutos — a causa da falha
       * generalizada relatada em 2026-11-23.
       */
      if (!r.reachable) record('watchplay', false)
      tried.push({ provider: 'watchplay', result: r.reachable ? 'no_hls' : 'unreachable' })
    }
  } else {
    tried.push({ provider: 'watchplay', result: 'breaker_open' })
  }

  // ── 2) Embed do watchplay (mesmo player, em iframe) ───────────────────────
  // Só quando o HLS não saiu. É o mesmo player, então não há anúncio novo.
  if (!sources.length && !isOpen('playerflix')) {
    const clean = await resolveCleanEmbed({ tmdbId: id, season, episode }).catch(() => null)
    if (clean && clean.id === 'watchplay') {
      record('playerflix', true)
      tried.push({ provider: 'playerflix', result: 'embed_watchplay' })
      sources.push({
        id: 'clean',
        label: clean.label || 'Servidor principal',
        url: clean.url,
        mode: 'embed',
        verified: true,
        provider: 'watchplay',
      })
    } else {
      /**
       * NÃO penaliza o host aqui.
       *
       * `resolveCleanEmbed` devolve `null` tanto para "host fora" quanto para
       * "título sem embed limpo" — e o segundo caso é a maioria do catálogo.
       * O disjuntor do host do Ajax já é tratado DENTRO do `fetchOptions`
       * (que só conta falha quando a requisição realmente falha), então
       * duplicar a contagem aqui só reintroduziria o bug de 2026-11-23.
       */
      tried.push({ provider: 'playerflix', result: clean ? `embed_${clean.id}` : 'no_embed' })
    }
  }

  // ── 3) HLS DIRETO do embedplayer (sem o iframe dele) ───────────────────────
  //
  // O `embedplayer2.xyz` era tratado como "embed com anúncio". O anúncio está
  // no IFRAME; o CDN do vídeo é limpo. O endpoint `getVideo` devolve o
  // `securedLink` do m3u8, e esse m3u8 toca no NOSSO <video> — nada do HTML
  // do iframe (trackers, poplimit) é carregado.
  //
  // Medido: 30% dos filmes e 25% das séries (que estavam em 0%). Entra DEPOIS
  // do watchplay (mais estável) e ANTES dos embeds de terceiro.
  if (!sources.length && !isOpen('embedplayer')) {
    const opts = await fetchOptions({ tmdbId: id, season, episode }).catch(() => [])
    const ep = opts.find((o) => o.id === 'embedplayer' && o.budget !== 'danger')
    if (ep) {
      const hash = ep.embed_id || String(ep.embed || '').split('/').pop()
      const stream = await resolveEmbedPlayerStream({ hash }).catch(() => null)
      if (stream) {
        record('embedplayer', true)
        tried.push({ provider: 'embedplayer', result: 'hls' })
        sources.push({
          id: 'embedplayer-hls',
          label: stream.label || 'Servidor alternativo',
          url: `/api/stream.m3u8?u=${encodeURIComponent(stream.url)}&r=${encodeURIComponent(stream.referer)}`,
          mode: 'direct',
          verified: true,
          provider: 'embedplayer',
        })
      } else {
        // Só penaliza quando o host respondeu mal de verdade. Um hash sem
        // m3u8 é falha do TÍTULO — mesma lição do bug de 2026-11-23.
        tried.push({ provider: 'embedplayer', result: 'no_hls' })
      }
    } else {
      tried.push({ provider: 'embedplayer', result: 'not_listed' })
    }
  }

  // ── 4) Embeds de terceiro (com anúncio) — só se autorizado ────────────────
  //
  // Medido: `embedplay` (embedplayabyss.top) carrega `sn.bataraanimals.com` e
  // `mz.sinonneurism.com`; `embedplayer` (embedplayer2.xyz) carrega
  // `tracker.Royale.com` e `tracker.advertising.com` com `poplimit:false`.
  // Ambos abrem pop-up. Ficam fora por padrão.
  if (!sources.length && ALLOW_AD_EMBEDS) {
    const opts = await fetchOptions({ tmdbId: id, season, episode }).catch(() => [])
    for (const opt of opts) {
      if (opt.budget === 'danger') continue
      if (opt.id !== 'embedplay' && opt.id !== 'embedplayer') continue
      if (isOpen(opt.id)) continue
      sources.push({
        id: opt.id,
        label: opt.label || 'Servidor alternativo',
        url: opt.embed,
        mode: 'embed',
        verified: null,
        provider: opt.id,
      })
      tried.push({ provider: opt.id, result: 'embed_ad' })
      break
    }
  }

  logDecision({
    tmdbId: id,
    season,
    episode,
    isEpisode,
    sources: sources.map((s) => `${s.provider}:${s.mode}`),
    tried,
  })

  return sources
}
