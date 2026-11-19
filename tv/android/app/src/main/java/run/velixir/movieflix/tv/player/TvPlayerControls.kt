package run.velixir.movieflix.tv.player

/**
 * Lógica PURA do controle remoto do player da TV.
 *
 * ── Por que este arquivo existe ──────────────────────────────────────────────
 *
 * Antes, o tratamento das teclas vivia dentro dos composables (`TvPlayerScreen`),
 * misturado com ExoPlayer e WebView. Isso tinha três consequências ruins:
 *
 *   1. não dava para testar sem uma TV — e o comportamento no aparelho real
 *      divergia do que o código parecia fazer;
 *   2. o avanço era RELATIVO (`currentTime + 10`), então cada passo partia de
 *      uma posição que o player ainda não tinha aplicado. Segurando a seta, os
 *      saltos se perdiam e o vídeo não parava no ponto exato;
 *   3. no modo direto (ExoPlayer) não havia tratamento de "soltar a tecla": o
 *      job de avanço rodava para sempre, pulando 4 min a cada 500 ms.
 *
 * Aqui não há Android, nem Compose, nem player: só aritmética de tempo e uma
 * máquina de estados. O player real (ExoPlayer ou WebView) apenas executa o que
 * esta classe manda — `onSeek(posiçãoAbsoluta)`. Por ser puro, roda em JVM e é
 * coberto por `scripts/test-tv-player.sh`.
 *
 * ── Regras implementadas (as que o usuário pediu) ────────────────────────────
 *
 *   OK            → alterna play/pause, sempre a partir do estado REAL
 *   ← / → curto   → ±10 s
 *   ← / → segurando → ±30 s, ±1 min, ±2 min, ±3 min, ±4 min (e 4 min depois)
 *   soltar        → para EXATAMENTE no alvo acumulado (seek absoluto)
 *
 * Volume foi REMOVIDO do player a pedido do proprietário (junto com legendas,
 * tela cheia, ajustes e troca de servidor). ↑ ↓ não fazem nada.
 */

/** Constantes de tempo e de passo. Uma fonte só, usada pelo app e pelos testes. */
object TvPlayerTiming {
    /** Toque curto na seta: 10 s (o usuário pediu "10 a 15 segundos"). */
    const val SHORT_STEP_SECONDS: Double = 10.0

    /** Quanto tempo a tecla precisa ficar pressionada para virar "segurar". */
    const val HOLD_DELAY_MS: Long = 500L

    /** Intervalo entre os saltos enquanto segura. */
    const val STEP_INTERVAL_MS: Long = 500L

    /**
     * Se nenhum evento da tecla chegar por este tempo, consideramos que o
     * controle soltou. É a rede de segurança para TV Box que não entrega
     * ACTION_UP ao WebView — sem isso o avanço continuaria sozinho.
     */
    const val RELEASE_TIMEOUT_MS: Long = 1200L

    /**
     * Janela em que um novo toque continua do alvo anterior em vez de reler a
     * posição do player (que pode ainda não ter aplicado o seek anterior).
     */
    const val REPEAT_BASE_MS: Long = 1200L

    /** Saltos progressivos enquanto segura: 30 s → 1 → 2 → 3 → 4 min. */
    val HOLD_STEPS: DoubleArray = doubleArrayOf(30.0, 60.0, 120.0, 180.0, 240.0)

    /**
     * Passo do volume — NÃO é mais usado pelo player.
     *
     * O proprietário pediu para remover volume (e legendas, tela cheia,
     * ajustes, troca de servidor) do player. A constante fica como registro
     * histórico; `VolumeController` foi removido de propósito, para que nenhum
     * código volte a desenhar volume sem uma decisão explícita.
     */
    const val VOLUME_STEP: Double = 0.1

    /** Janela de debounce do OK, para o auto-repeat do controle não piscar. */
    const val TOGGLE_DEBOUNCE_MS: Long = 250L

    /**
     * Depois de mandar OK, quanto tempo esperar antes de concluir que o player
     * não obedeceu. É o que transforma "precisa apertar várias vezes" em
     * "um toque só": se o estado não mudou neste tempo, o app reenvia o comando
     * (play ou pause EXPLÍCITO, não um novo toggle).
     */
    const val TOGGLE_CONFIRM_MS: Long = 400L

    /** Quantas vezes o comando é (re)enviado no mesmo toque. 3 = ~1,2 s. */
    const val TOGGLE_MAX_ATTEMPTS: Int = 3

    /**
     * Tempo sem interação até os controles sumirem da tela.
     *
     * O usuário pediu 5 segundos: a barra aparece ao interagir e some depois
     * disso, deixando só o vídeo. Qualquer tecla do controle a traz de volta.
     */
    const val UI_HIDE_MS: Long = 5_000L
}

/**
 * Avanço/retrocesso com aceleração progressiva e parada exata.
 *
 * O estado é sempre um ALVO ABSOLUTO em segundos. Cada passo soma ao alvo e o
 * player recebe `onSeek(alvo)` — nunca "ande mais 30 s a partir de onde você
 * estiver". É isso que faz o vídeo parar no número exato da barra: o alvo não
 * depende do que o player reportou no meio do caminho.
 *
 * @param positionProvider posição atual em segundos (lida do player real)
 * @param durationProvider duração em segundos (0 se ainda desconhecida)
 * @param onSeek recebe a posição ABSOLUTA, em segundos, para onde ir
 */
class SeekController(
    private val positionProvider: () -> Double,
    private val durationProvider: () -> Double,
    private val onSeek: (Double) -> Unit,
    private val shortStep: Double = TvPlayerTiming.SHORT_STEP_SECONDS,
    private val holdDelayMs: Long = TvPlayerTiming.HOLD_DELAY_MS,
    private val stepIntervalMs: Long = TvPlayerTiming.STEP_INTERVAL_MS,
    private val releaseTimeoutMs: Long = TvPlayerTiming.RELEASE_TIMEOUT_MS,
    private val repeatBaseMs: Long = TvPlayerTiming.REPEAT_BASE_MS,
    private val holdSteps: DoubleArray = TvPlayerTiming.HOLD_STEPS,
) {
    /** -1 retrocede, +1 avança, 0 parado. */
    var direction: Int = 0
        private set

    /** Alvo absoluto atual, em segundos. */
    var target: Double = 0.0
        private set

    /** Já passou do tempo de "segurar" e está dando saltos grandes. */
    var holding: Boolean = false
        private set

    /** Último passo aplicado, em segundos (para a dica na tela). */
    var lastStepSeconds: Double = 0.0
        private set

    val active: Boolean get() = direction != 0

    private var pressedAt: Long = 0L
    private var lastEventAt: Long = 0L
    private var nextStepAt: Long = 0L
    private var stepIndex: Int = 0

    /**
     * Instante do último release, ou null se nunca houve um.
     *
     * NÃO usar `Long.MIN_VALUE` como sentinela: `now - Long.MIN_VALUE` estoura
     * e vira negativo, o que fazia a primeira tecla achar que "o toque anterior
     * foi agora" e partir do alvo 0 em vez da posição real do vídeo. Era um bug
     * de verdade, pego pelo teste [1] de `scripts/test-tv-player.sh`.
     */
    private var lastReleaseAt: Long? = null
    private var lastTarget: Double = 0.0

    /** Direção do último movimento — o rótulo precisa dela depois do release. */
    private var lastDirection: Int = 0

    /**
     * Tecla pressionada.
     *
     * @param repeatCount `KeyEvent.repeatCount` do Android (0 no primeiro evento)
     * @return true se ESTE evento iniciou um novo movimento (o chamador deve
     *         mostrar a dica); false se é só repetição do mesmo movimento.
     */
    fun onKeyDown(dir: Int, repeatCount: Int, now: Long): Boolean {
        if (dir == 0) return false

        // Mesma direção já ativa: é auto-repeat do controle. Só mantém vivo.
        if (active && dir == direction) {
            lastEventAt = now
            return false
        }

        // Trocou de direção sem soltar a anterior: fecha a anterior no alvo.
        if (active) release(now)

        // Base do movimento: se o toque anterior foi há pouco, continua do alvo
        // dele (o player pode ainda não ter aplicado o seek). Senão, lê o real.
        val sinceRelease = lastReleaseAt?.let { now - it }
        val base = if (sinceRelease != null && sinceRelease <= repeatBaseMs) lastTarget
        else positionProvider()

        direction = dir
        lastDirection = dir
        target = clamp(base)
        pressedAt = now
        lastEventAt = now
        holding = false
        stepIndex = 0
        lastStepSeconds = 0.0
        nextStepAt = now + holdDelayMs
        return true
    }

    /**
     * Chamado periodicamente (a cada ~50 ms) enquanto o player está aberto.
     * É o que faz o avanço acelerar sozinho enquanto a tecla está pressionada,
     * e o que solta a tecla quando o aparelho não manda ACTION_UP.
     */
    fun tick(now: Long) {
        if (!active) return

        // Watchdog: aparelho que não entrega ACTION_UP.
        if (now - lastEventAt > releaseTimeoutMs) {
            release(now)
            return
        }

        if (!holding) {
            if (now < pressedAt + holdDelayMs) return
            holding = true
            nextStepAt = now
        }

        // Se o app ficou congelado, não tenta "recuperar" todos os saltos
        // perdidos de uma vez — isso pularia minutos sem o usuário pedir.
        if (now - nextStepAt > stepIntervalMs * 3) nextStepAt = now

        var guard = 0
        while (active && now >= nextStepAt && guard < 4) {
            guard++
            val step = holdSteps[minOf(stepIndex, holdSteps.lastIndex)]
            stepIndex++
            lastStepSeconds = step
            target = clamp(target + direction * step)
            onSeek(target)
            nextStepAt += stepIntervalMs
        }
    }

    /**
     * Tecla solta.
     *
     * Toque curto (nunca virou "segurar") aplica o passo curto de 10 s.
     * Em qualquer caso, o alvo é reenviado como seek ABSOLUTO — é o que garante
     * que o vídeo pare exatamente no ponto mostrado na barra.
     *
     * @return true se havia movimento ativo
     */
    fun onKeyUp(now: Long): Boolean {
        if (!active) return false
        if (!holding) {
            lastStepSeconds = shortStep
            target = clamp(target + direction * shortStep)
        }
        onSeek(target)
        release(now)
        return true
    }

    /** Cancela sem aplicar nada (ex.: sair do player). */
    fun cancel() {
        direction = 0
        holding = false
    }

    private fun release(now: Long) {
        lastReleaseAt = now
        lastTarget = target
        direction = 0
        holding = false
    }

    /** Direção do último movimento (−1, 0 ou +1). */
    fun lastDirection(): Int = lastDirection

    private fun clamp(v: Double): Double {
        val d = durationProvider()
        val hi = if (d > 0) d else Double.MAX_VALUE
        return v.coerceIn(0.0, hi)
    }

    /** "+10s", "+30s", "+1min", "−2min" — o que aparece no centro da tela. */
    fun stepLabel(): String {
        val s = lastStepSeconds
        val sign = if (lastDirection < 0) "−" else "+"
        val body = when {
            s >= 60.0 && s % 60.0 == 0.0 -> "${(s / 60.0).toInt()}min"
            else -> "${s.toInt()}s"
        }
        return "$sign$body"
    }
}

/**
 * OK = play/pause.
 *
 * O comando enviado é sempre "toggle" e quem decide é o player, olhando o
 * estado REAL do `<video>` (`v.paused`) ou do ExoPlayer (`isPlaying`). O app
 * não tenta adivinhar: era exatamente aí que o OK "não funcionava" — o app
 * achava que estava tocando, mandava pausar, e o vídeo já estava pausado.
 *
 * O debounce evita que o auto-repeat do controle mande dois toggles e o vídeo
 * fique piscando (pausa → play) num único toque.
 */
class PlayPauseController(
    private val debounceMs: Long = TvPlayerTiming.TOGGLE_DEBOUNCE_MS,
    private val confirmMs: Long = TvPlayerTiming.TOGGLE_CONFIRM_MS,
    private val maxAttempts: Int = TvPlayerTiming.TOGGLE_MAX_ATTEMPTS,
) {
    /** Último estado REAL reportado pelo player. */
    var playing: Boolean = false
        private set

    /** Null = nenhum toque ainda (ver a nota sobre `Long.MIN_VALUE` acima). */
    private var lastToggleAt: Long? = null

    /**
     * Estado que o player DEVE assumir depois do toque (`null` = nada pendente).
     *
     * Guardar o alvo, e não "mais um toggle", é o que permite reenviar sem
     * risco: se o primeiro comando funcionou mas o estado demorou a chegar,
     * reenviar o mesmo alvo (play/pause) não inverte de novo o vídeo.
     */
    private var expected: Boolean? = null
    private var lastSentAt: Long = 0L
    private var attempts: Int = 0

    /** @return true se o comando deve ser enviado ao player. */
    fun onKey(now: Long): Boolean {
        val since = lastToggleAt?.let { now - it }
        if (since != null && since < debounceMs) return false
        lastToggleAt = now
        expected = !playing
        lastSentAt = now
        attempts = 1
        return true
    }

    /** O player reportou o estado real. */
    fun onState(isPlaying: Boolean) {
        playing = isPlaying
        if (expected != null && isPlaying == expected) {
            expected = null
            attempts = 0
        }
    }

    /**
     * O toque ainda não surtiu efeito e já passou o tempo de confirmação.
     *
     * @return o comando EXPLÍCITO a reenviar (`true` = play, `false` = pause),
     *         ou `null` se não há nada a fazer.
     */
    fun retry(now: Long): Boolean? {
        val want = expected ?: return null
        if (attempts >= maxAttempts) {
            expected = null
            return null
        }
        if (now - lastSentAt < confirmMs) return null
        lastSentAt = now
        attempts++
        return want
    }

    /** Há um comando aguardando confirmação. */
    val pending: Boolean get() = expected != null

    /**
     * Dica a mostrar AGORA, antes de o player confirmar: o resultado esperado
     * do toggle é o inverso do estado atual.
     */
    fun hint(): String = if (playing) "⏸ Pausado" else "▶ Reproduzindo"
}

/**
 * Visibilidade dos controles na tela, com auto-hide.
 *
 * Puro (só números), pelo mesmo motivo do [SeekController]: dá para testar em
 * JVM o que antes dependia de olhar a TV. A tela chama [poke] em toda tecla e
 * [tick] no laço de 50 ms do player.
 */
class UiVisibility(
    private val hideAfterMs: Long = TvPlayerTiming.UI_HIDE_MS,
) {
    var visible: Boolean = true
        private set

    /**
     * Instante da última interação.
     *
     * `null` = nenhuma ainda. NÃO usar 0 como sentinela: `uptimeMillis()` na TV
     * já está em milhares de milissegundos no primeiro tick, então a barra
     * nasceria escondida (some antes de o usuário ver). O primeiro [tick]
     * apenas marca o início da contagem.
     */
    private var lastInteractionAt: Long? = null

    /** Houve interação: mostra e reinicia o relógio. */
    fun poke(now: Long) {
        visible = true
        lastInteractionAt = now
    }

    /** Esconde quando o tempo sem interação passa do limite. */
    fun tick(now: Long) {
        val since = lastInteractionAt
        if (since == null) {
            // Primeira volta do laço: começa a contar daqui.
            lastInteractionAt = now
            visible = true
            return
        }
        if (visible && now - since >= hideAfterMs) visible = false
    }
}
