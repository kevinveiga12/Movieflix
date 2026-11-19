package run.velixir.movieflix.tv.player

/**
 * Mouse virtual controlado pelo controle remoto.
 *
 * ── Regra do proprietário ────────────────────────────────────────────────────
 *   • segurar OK por 2 s  → LIGA o mouse;
 *   • segurar OK por 2 s  → DESLIGA o mouse;
 *   • direcional          → move o cursor;
 *   • OK                  → clica na posição do cursor;
 *   • com o mouse desligado, a navegação convencional continua igual.
 *
 * ── Por que a lógica vive aqui, em Kotlin puro ───────────────────────────────
 * O movimento e o limite do cursor não dependem de Android nem de Compose, então
 * podem ser exercitados na JVM (scripts/test-tv-player.sh) sem emulador. A tela
 * só desenha o cursor e repassa as teclas.
 *
 * O passo é em pixels de tela; a tela informa o tamanho real em [setBounds].
 */
class VirtualMouseState(
    private val stepPx: Float = 28f,
) {
    /** Mouse ligado? Quando falso, o D-pad volta a navegar normalmente. */
    var active: Boolean = false
        private set

    var x: Float = 0f
        private set
    var y: Float = 0f
        private set

    private var width: Float = 1920f
    private var height: Float = 1080f
    /** Já recebeu o tamanho real da tela? Antes disso o cursor não foi posicionado. */
    private var initialized: Boolean = false

    /** A tela informou o tamanho: centraliza o cursor na primeira vez. */
    fun setBounds(w: Float, h: Float) {
        if (w <= 0f || h <= 0f) return
        val first = !initialized
        width = w
        height = h
        initialized = true
        if (first) {
            x = w / 2f
            y = h / 2f
        } else {
            x = x.coerceIn(0f, w)
            y = y.coerceIn(0f, h)
        }
    }

    /** Liga/desliga o mouse. Ao ligar, garante o cursor dentro da tela. */
    fun toggle() {
        active = !active
        if (active) {
            x = x.coerceIn(0f, width)
            y = y.coerceIn(0f, height)
        }
    }

    /**
     * Move o cursor.
     *
     * @param dx -1 (esquerda), 0 ou +1 (direita)
     * @param dy -1 (cima), 0 ou +1 (baixo)
     */
    fun move(dx: Int, dy: Int) {
        if (!active) return
        x = (x + dx * stepPx).coerceIn(0f, width)
        y = (y + dy * stepPx).coerceIn(0f, height)
    }

    /** Posição normalizada (0..1) — usada para clicar dentro do player. */
    fun ratioX(): Float = if (width > 0f) (x / width).coerceIn(0f, 1f) else 0.5f
    fun ratioY(): Float = if (height > 0f) (y / height).coerceIn(0f, 1f) else 0.5f
}

/**
 * Detector de "segurar OK por N ms".
 *
 * Um toque curto devolve [PressResult.Short] (a ação normal do OK); segurar até
 * o limite devolve [PressResult.Hold] uma única vez, no instante em que o tempo
 * é atingido — assim o mouse liga enquanto o dedo ainda está no botão, com
 * retorno visual imediato.
 */
class HoldDetector(
    private val holdMs: Long = 2_000L,
) {
    enum class PressResult { Short, Hold }

    private var downAt: Long? = null
    private var fired = false

    fun onDown(now: Long) {
        downAt = now
        fired = false
    }

    /** Chamado no laço de relógio: devolve Hold quando o limite é atingido. */
    fun tick(now: Long): PressResult? {
        val start = downAt ?: return null
        if (fired) return null
        if (now - start >= holdMs) {
            fired = true
            return PressResult.Hold
        }
        return null
    }

    /** Soltou o botão: devolve Short se não houve Hold. */
    fun onUp(): PressResult? {
        val wasFired = fired
        downAt = null
        fired = false
        return if (wasFired) null else PressResult.Short
    }

    fun cancel() {
        downAt = null
        fired = false
    }
}
