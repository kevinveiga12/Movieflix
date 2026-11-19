/**
 * Mouse virtual controlado pelo controle remoto (TV / TV Box / Smart TV).
 *
 * ── Regra do proprietário ────────────────────────────────────────────────────
 *   • segurar OK por 2 s  → LIGA o mouse;
 *   • segurar OK por 2 s  → DESLIGA o mouse;
 *   • direcional          → move o cursor;
 *   • OK                  → clica na posição do cursor;
 *   • com o mouse desligado, a navegação convencional continua igual.
 *
 * ── Por que a lógica vive aqui, sem React ────────────────────────────────────
 * O movimento, o limite da tela e o detector de "segurar" não dependem do DOM
 * nem de componente, então podem ser exercitados em Node puro
 * (scripts/test-virtual-mouse.mjs) sem navegador. A página só desenha o cursor
 * e repassa as teclas.
 */

/** Tempo que o OK precisa ficar pressionado para ligar/desligar o mouse. */
export const HOLD_MS = 2_000

/** Passo do cursor por toque no direcional, em pixels de tela. */
export const STEP_PX = 28

export interface Cursor {
  x: number
  y: number
}

/**
 * Estado do mouse virtual.
 *
 * `active` falso = navegação convencional (o D-pad segue o fluxo normal da
 * página). `active` verdadeiro = o D-pad move o cursor e o OK clica.
 */
export class VirtualMouse {
  active = false
  x = 0
  y = 0
  private width = 0
  private height = 0
  private initialized = false

  constructor(private readonly step: number = STEP_PX) {}

  /** A tela informou o tamanho: centraliza o cursor na primeira vez. */
  setBounds(w: number, h: number): void {
    if (!(w > 0) || !(h > 0)) return
    const first = !this.initialized
    this.width = w
    this.height = h
    this.initialized = true
    if (first) {
      this.x = w / 2
      this.y = h / 2
    } else {
      this.x = clamp(this.x, 0, w)
      this.y = clamp(this.y, 0, h)
    }
  }

  /** Liga/desliga. Ao ligar, garante o cursor dentro da tela. */
  toggle(): void {
    this.active = !this.active
    if (this.active) {
      this.x = clamp(this.x, 0, this.width)
      this.y = clamp(this.y, 0, this.height)
    }
  }

  /** Move o cursor. Desligado, não faz nada (navegação normal preservada). */
  move(dx: number, dy: number): void {
    if (!this.active) return
    this.x = clamp(this.x + dx * this.step, 0, this.width)
    this.y = clamp(this.y + dy * this.step, 0, this.height)
  }

  /** Fração 0..1 da tela — é o que o clique usa. */
  ratioX(): number {
    return this.width > 0 ? clamp(this.x / this.width, 0, 1) : 0.5
  }

  ratioY(): number {
    return this.height > 0 ? clamp(this.y / this.height, 0, 1) : 0.5
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export type PressResult = 'short' | 'hold' | null

/**
 * Detector de "segurar OK por N ms".
 *
 * Um toque curto devolve `short` (ação normal do OK); segurar até o limite
 * devolve `hold` uma única vez, no instante em que o tempo é atingido — assim o
 * mouse liga enquanto o botão ainda está pressionado, com retorno imediato.
 */
export class HoldDetector {
  private downAt: number | null = null
  private fired = false

  constructor(private readonly holdMs: number = HOLD_MS) {}

  onDown(now: number): void {
    this.downAt = now
    this.fired = false
  }

  /** Chamado no laço de relógio: devolve 'hold' quando o limite é atingido. */
  tick(now: number): PressResult {
    if (this.downAt === null || this.fired) return null
    if (now - this.downAt >= this.holdMs) {
      this.fired = true
      return 'hold'
    }
    return null
  }

  /** Soltou o botão: 'short' se não houve 'hold'. */
  onUp(): PressResult {
    const wasFired = this.fired
    this.downAt = null
    this.fired = false
    return wasFired ? null : 'short'
  }

  cancel(): void {
    this.downAt = null
    this.fired = false
  }
}

/**
 * Clique sintético na posição do cursor.
 *
 * Recebe a fração da tela e despacha os eventos de mouse no elemento que está
 * naquele ponto. É assim que o mouse do controle alcança os controles nativos
 * do player (play/pause, barra, volume, tela cheia) sem duplicar botões.
 *
 * Devolve o elemento clicado (ou null quando não há nada ali).
 */
export function clickAtRatio(
  doc: Document,
  win: Window,
  fx: number,
  fy: number,
): Element | null {
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null
  const x = Math.round(fx * (win.innerWidth || 1))
  const y = Math.round(fy * (win.innerHeight || 1))
  const el = doc.elementFromPoint(x, y)
  if (!el) return null
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    view: win,
    button: 0,
    buttons: 1,
  }
  for (const type of ['mousemove', 'mousedown', 'mouseup', 'click'] as const) {
    try {
      el.dispatchEvent(new MouseEvent(type, opts))
    } catch {
      /* navegador antigo sem MouseEvent — segue para o próximo */
    }
  }
  return el
}
