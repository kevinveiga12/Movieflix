/**
 * ════════════════════════════════════════════════════════════════════════════
 * TELA CHEIA AUTOMÁTICA AO CLICAR EM "ASSISTIR"
 * ════════════════════════════════════════════════════════════════════════════
 *
 * O proprietário pediu: ao clicar em "Assistir" (filme ou série), o player já
 * entra em tela cheia, sem um segundo toque.
 *
 * ── O PROBLEMA DO GESTO ────────────────────────────────────────────────────
 *
 * A Fullscreen API só aceita `requestFullscreen()` dentro de um GESTO DO
 * USUÁRIO. O clique em "Assistir" é um gesto, mas ele acontece na página do
 * título — e o player só monta depois da navegação (React Router) e depois de
 * `/api/playback/authorize` responder. Quando o player finalmente tem o
 * contêiner na tela, o gesto já expirou e o navegador recusa a chamada.
 *
 * ── A SOLUÇÃO: DOIS CAMINHOS ───────────────────────────────────────────────
 *
 * 1) `enterFullscreenNow()` — chamado DENTRO do clique, de forma síncrona,
 *    antes de qualquer `await`. Coloca `document.documentElement` em tela
 *    cheia. Como a navegação do React Router NÃO recarrega o documento, o
 *    estado de tela cheia SOBREVIVE à troca de página: o player já nasce em
 *    tela cheia. É o caminho que funciona de verdade.
 *
 * 2) `requestAutoFullscreen()` — registra a INTENÇÃO em `sessionStorage`.
 *    Serve de reserva para quando o caminho 1 não existe (iOS Safari sem
 *    suporte a tela cheia de elemento, WebView antigo). O player consome a
 *    intenção ao montar e cai no modo imersivo por CSS: `.player-page` já é
 *    `position: fixed; inset: 0`, então o resultado visual é o mesmo — só o
 *    vídeo na tela, sem barra do site.
 *
 * A intenção é de uso único e expira: se a pessoa clicar em "Assistir" e a
 * navegação falhar, ela não fica presa em tela cheia na próxima visita.
 */

/** Chave da intenção. `sessionStorage` sobrevive à navegação, mas não à aba. */
const KEY = 'mf:auto-fullscreen'

/** Quanto tempo a intenção continua válida depois do clique. */
const TTL_MS = 20_000

interface Intent {
  /** Momento do clique (epoch ms). */
  at: number
  /** Destino que o clique queria abrir — evita disparar no título errado. */
  href: string
}

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

/** O documento está em tela cheia agora? (inclui o prefixo do WebKit) */
export function isDocumentFullscreen(): boolean {
  const doc = document as FsDoc
  return Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement ?? null)
}

/**
 * Entra em tela cheia AGORA, de forma síncrona.
 *
 * Precisa ser chamado dentro do handler do clique — sem `await` antes, senão o
 * navegador considera que o gesto expirou e recusa em silêncio.
 *
 * Devolve `true` se a chamada foi aceita. `false` significa que o navegador não
 * tem a API (iOS Safari antigo) ou recusou — nesse caso o chamador deve usar o
 * modo imersivo por CSS.
 */
export function enterFullscreenNow(): boolean {
  const doc = document as FsDoc
  if (isDocumentFullscreen()) return true

  const el = document.documentElement as FsEl
  try {
    if (el.requestFullscreen) {
      // A promessa é ignorada de propósito: o estado real é lido depois pelo
      // evento `fullscreenchange`. Um `await` aqui perderia o gesto.
      void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
      return true
    }
    if (el.webkitRequestFullscreen) {
      void el.webkitRequestFullscreen()
      return true
    }
  } catch {
    return false
  }
  return false
}

/** Sai da tela cheia do documento, se estiver nela. */
export async function exitFullscreenNow(): Promise<void> {
  const doc = document as FsDoc
  try {
    if (document.exitFullscreen) await document.exitFullscreen()
    else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen()
  } catch {
    /* já fora da tela cheia */
  }
}

/**
 * Registra a intenção de entrar em tela cheia.
 *
 * Chamado no `onClick` do link "Assistir", ANTES da navegação. É a reserva do
 * `enterFullscreenNow()`: cobre os navegadores que não têm tela cheia de
 * elemento, onde o player precisa cair no modo imersivo por CSS.
 */
export function requestAutoFullscreen(href: string): void {
  try {
    const intent: Intent = { at: Date.now(), href }
    sessionStorage.setItem(KEY, JSON.stringify(intent))
  } catch {
    /* modo privado / storage bloqueado: simplesmente não há intenção */
  }
}

/**
 * Consome a intenção, se houver e se ainda valer.
 *
 * Devolve `true` uma única vez — a chave é apagada na leitura, então recarregar
 * o player não entra em tela cheia de novo sozinho.
 */
export function consumeAutoFullscreen(href: string): boolean {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return false
    sessionStorage.removeItem(KEY)

    const intent = JSON.parse(raw) as Intent
    if (!intent || typeof intent.at !== 'number') return false
    if (Date.now() - intent.at > TTL_MS) return false
    // Só vale para o destino que foi clicado.
    if (intent.href && intent.href !== href) return false
    return true
  } catch {
    return false
  }
}

/** Descarta a intenção (ex.: o player não conseguiu abrir o título). */
export function clearAutoFullscreen(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* nada a fazer */
  }
}
