import type { Title } from './types'

/**
 * Resolução da fonte de reprodução.
 *
 * ── O QUE FOI APURADO (testes reais em 2026-11-18) ─────────────────────────
 *
 * Todo o catálogo aponta para `streambetter.shop/filme/{id}`. Ao abrir essa
 * página dentro de um iframe ela NÃO entrega o vídeo: responde com um desafio
 * anti-bot do Cloudflare Turnstile ("Confirmando que você é uma pessoa de
 * verdade..."). O desafio não se completa dentro de um iframe, e a página
 * então tenta escapar — daí o redirecionamento para fora do MovieFlix e, ao
 * voltar, a reprodução bloqueada.
 *
 * Outros provedores testados no mesmo dia:
 *   - vidsrc.to     → recusa explicitamente iframe com `sandbox`
 *   - vidlink.pro   → "Please Disable Sandbox": só toca se retirarmos o sandbox
 *   - 2embed.cc     → devolve o título errado para o id pedido
 *   - embed.su / multiembed.mov / vidsrc.icu / vidsrc.pro → não entregam player
 *
 * Conclusão: nenhum embed de terceiro permite reprodução incorporada COM as
 * proteções de segurança que o MovieFlix exige (sem pop-up, sem navegação da
 * janela principal). Reproduzir de qualquer jeito exigiria remover o `sandbox`
 * e liberar `allow-popups`, que é exatamente o que causa o redirecionamento e
 * os anúncios que o cliente relatou. Portanto o embed não é tratado como
 * reprodução garantida.
 *
 * ── COMO O APP SE COMPORTA AGORA ───────────────────────────────────────────
 *
 *  1) `direct` → arquivo de mídia (MP4/HLS). É o caminho preferido e o único
 *     que o MovieFlix apresenta como reprodução garantida: controle total,
 *     retomada exata, sem anúncio e sem saída do site.
 *  2) `embed`  → página de terceiro. Continua existindo, mas SEMPRE com
 *     sandbox restritivo (`allow-scripts allow-same-origin allow-presentation
 *     allow-forms`), nunca com `allow-popups` nem `allow-top-navigation`.
 *     Assim o pior caso é o player não carregar DENTRO do site — nunca o
 *     cliente ser jogado para outro site. Se não carregar, a UI mostra um
 *     estado de indisponibilidade curto e em português, sem jargão técnico.
 *
 * O modo vem do servidor (`/api/playback/authorize`), então cadastrar uma URL
 * direta no painel promove o título a `direct` sem alterar o frontend.
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

/**
 * Sandbox usado em TODA incorporação de terceiro.
 *
 * Deliberadamente NÃO inclui:
 *   - allow-popups            → bloqueia janelas/anúncios em aba nova
 *   - allow-top-navigation*   → bloqueia o provedor de trocar a página do
 *                               MovieFlix (a causa do "fui jogado pra fora")
 *   - allow-modals            → bloqueia alert/confirm do provedor
 *
 * Inclui o mínimo para um player funcionar:
 *   - allow-scripts           → o player é JS
 *   - allow-same-origin       → necessário para o player acessar o próprio
 *                               storage/HLS segments
 *   - allow-presentation      → permite entrar em tela cheia
 *   - allow-forms              → login/legendas de alguns provedores
 */
export const EMBED_SANDBOX =
  'allow-scripts allow-same-origin allow-presentation allow-forms'

/** `allow` do iframe — o que a página incorporada pode usar do dispositivo. */
export const EMBED_ALLOW =
  'autoplay; fullscreen; encrypted-media; picture-in-picture'

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
