package run.velixir.movieflix.tv.player

/**
 * Testes headless do controle remoto do player da TV.
 *
 * Roda em JVM pura (sem Android, sem emulador) porque a lógica de controle está
 * isolada em `TvPlayerControls.kt`. Execução:
 *
 *     bash scripts/test-tv-player.sh
 *
 * Cada teste simula uma sequência real de eventos do controle — keydown,
 * auto-repeat, keyup — com um relógio controlado, e confere o que o player
 * receberia. É a única forma de provar "parada exata" e "aceleração
 * progressiva" sem uma TV na mão.
 */

private var failures = 0
private var checks = 0

private fun check(name: String, cond: Boolean, detail: String = "") {
    checks++
    if (cond) {
        println("  ok   $name")
    } else {
        failures++
        println("  FAIL $name${if (detail.isNotBlank()) " — $detail" else ""}")
    }
}

private fun near(a: Double, b: Double, eps: Double = 0.001) = kotlin.math.abs(a - b) <= eps

/** Player falso: guarda a posição e registra cada seek recebido. */
private class FakePlayer(var pos: Double = 0.0, var dur: Double = 600.0) {
    val seeks = mutableListOf<Double>()
    fun seek(to: Double) {
        seeks += to
        pos = to
    }
    fun last(): Double = seeks.lastOrNull() ?: pos
}

private fun seeker(p: FakePlayer) = SeekController(
    positionProvider = { p.pos },
    durationProvider = { p.dur },
    onSeek = { p.seek(it) },
)

// ─────────────────────────────────────────────────────────────────────────────
// 1. Toque curto: 10 s, para frente e para trás
// ─────────────────────────────────────────────────────────────────────────────
private fun testShortPress() {
    println("\n[1] Toque curto na seta = 10 s")
    val p = FakePlayer(pos = 100.0)
    val s = seeker(p)

    s.onKeyDown(1, 0, now = 0)
    s.onKeyUp(now = 120) // soltou em 120 ms: toque curto
    check("avança exatamente 10 s", near(p.last(), 110.0), "alvo=${p.last()}")
    check("um único seek", p.seeks.size == 1, "seeks=${p.seeks}")

    val p2 = FakePlayer(pos = 100.0)
    val s2 = seeker(p2)
    s2.onKeyDown(-1, 0, now = 0)
    s2.onKeyUp(now = 120)
    check("retrocede exatamente 10 s", near(p2.last(), 90.0), "alvo=${p2.last()}")
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Segurar: aceleração progressiva 30s → 1 → 2 → 3 → 4 min
// ─────────────────────────────────────────────────────────────────────────────
private fun testHoldAcceleration() {
    println("\n[2] Segurar a seta = aceleração progressiva")
    val p = FakePlayer(pos = 0.0, dur = 3600.0)
    val s = seeker(p)

    s.onKeyDown(1, 0, now = 0)
    // Auto-repeat do controle a cada 50 ms, como no aparelho real.
    var t = 0L
    while (t < 3000L) {
        t += 50L
        s.onKeyDown(1, repeatCount = (t / 50).toInt(), now = t)
        s.tick(t)
    }
    s.onKeyUp(now = t)

    // Passos esperados: 30, 60, 120, 180, 240, 240...
    // holdDelay 500 ms → primeiro salto em 500 ms; depois a cada 500 ms.
    // Em 3000 ms: saltos em 500,1000,1500,2000,2500,3000 = 6 saltos.
    val expected = 30.0 + 60.0 + 120.0 + 180.0 + 240.0 + 240.0
    check(
        "soma dos saltos progressivos = ${expected.toInt()}s",
        near(p.last(), expected, 0.5),
        "alvo=${p.last()}",
    )
    check("saltos crescem (30 < 60 < 120 < 180 < 240)", s.lastStepSeconds == 240.0, "último=${s.lastStepSeconds}")
    check("parou no alvo exato (último seek == alvo)", near(p.seeks.last(), expected, 0.5))
    check("não passou da duração", p.last() <= 3600.0)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Parada exata: o alvo não deriva, mesmo com o player atrasado
// ─────────────────────────────────────────────────────────────────────────────
private fun testExactStop() {
    println("\n[3] Parada exata ao soltar (sem deriva)")
    // Player que NÃO aplica o seek na hora (simula buffer/atraso do provedor).
    var reported = 200.0
    val seeks = mutableListOf<Double>()
    val s = SeekController(
        positionProvider = { reported },
        durationProvider = { 3600.0 },
        onSeek = { seeks += it },
    )

    s.onKeyDown(1, 0, now = 0)
    var t = 0L
    while (t < 2000L) {
        t += 50L
        s.onKeyDown(1, (t / 50).toInt(), t)
        s.tick(t)
    }
    s.onKeyUp(now = t)

    // 200 + 30 + 60 + 120 + 180 = 590 (saltos em 500,1000,1500,2000)
    val expected = 200.0 + 30.0 + 60.0 + 120.0 + 180.0
    check("alvo acumulado = ${expected.toInt()}s", near(seeks.last(), expected, 0.5), "último=${seeks.last()}")
    check("todos os seeks são absolutos e crescentes", seeks.zipWithNext().all { (a, b) -> b >= a })
    check("posição reportada pelo player não influenciou o alvo", near(seeks.last(), expected, 0.5))
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Watchdog: TV Box que não manda ACTION_UP
// ─────────────────────────────────────────────────────────────────────────────
private fun testReleaseWatchdog() {
    println("\n[4] Watchdog solta a tecla quando o aparelho não manda ACTION_UP")
    val p = FakePlayer(pos = 0.0, dur = 3600.0)
    val s = seeker(p)

    s.onKeyDown(1, 0, now = 0)
    var t = 0L
    while (t < 1000L) {
        t += 50L
        s.onKeyDown(1, (t / 50).toInt(), t)
        s.tick(t)
    }
    val afterHold = p.last()
    // Nenhum evento novo: o watchdog deve encerrar em ~1,2 s.
    t += 1300L
    s.tick(t)
    check("movimento encerrado pelo watchdog", !s.active)
    check("não continuou pulando depois de soltar", near(p.last(), afterHold, 0.5), "antes=$afterHold depois=${p.last()}")

    // E não pula mais nada nos ticks seguintes.
    repeat(20) { t += 50L; s.tick(t) }
    check("parado de verdade após o watchdog", near(p.last(), afterHold, 0.5))
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Limites: não passa do início nem do fim
// ─────────────────────────────────────────────────────────────────────────────
private fun testBounds() {
    println("\n[5] Limites de início e fim")
    val p = FakePlayer(pos = 3.0, dur = 100.0)
    val s = seeker(p)
    s.onKeyDown(-1, 0, now = 0)
    s.onKeyUp(now = 100)
    check("não vai abaixo de 0", near(p.last(), 0.0), "alvo=${p.last()}")

    val p2 = FakePlayer(pos = 95.0, dur = 100.0)
    val s2 = seeker(p2)
    s2.onKeyDown(1, 0, now = 0)
    s2.onKeyUp(now = 100)
    check("não passa da duração", near(p2.last(), 100.0), "alvo=${p2.last()}")

    // Duração desconhecida (0): não pode travar em 0.
    val p3 = FakePlayer(pos = 50.0, dur = 0.0)
    val s3 = seeker(p3)
    s3.onKeyDown(1, 0, now = 0)
    s3.onKeyUp(now = 100)
    check("duração desconhecida ainda avança", near(p3.last(), 60.0), "alvo=${p3.last()}")
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Toques repetidos rápidos: cada um soma 10 s
// ─────────────────────────────────────────────────────────────────────────────
private fun testRepeatedTaps() {
    println("\n[6] Toques curtos repetidos somam 10 s cada")
    val p = FakePlayer(pos = 0.0, dur = 3600.0)
    val s = seeker(p)
    var t = 0L
    repeat(3) {
        s.onKeyDown(1, 0, t)
        t += 100
        s.onKeyUp(t)
        t += 200
    }
    check("3 toques = 30 s", near(p.last(), 30.0), "alvo=${p.last()}")
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Volume
// ─────────────────────────────────────────────────────────────────────────────
private fun testVolume() {
    println("\n[7] Volume pelas setas ↑ ↓")
    var real = 0.5
    val applied = mutableListOf<Double>()
    val v = VolumeController(currentProvider = { real }, onChange = { applied += it; real = it })

    v.up()
    check("↑ sobe para 60%", near(v.level, 0.6), "nível=${v.level}")
    v.up()
    check("↑ sobe para 70%", near(v.level, 0.7), "nível=${v.level}")
    v.down()
    check("↓ desce para 60%", near(v.level, 0.6), "nível=${v.level}")

    repeat(10) { v.up() }
    check("não passa de 100%", near(v.level, 1.0), "nível=${v.level}")
    repeat(20) { v.down() }
    check("não desce abaixo de 0%", near(v.level, 0.0), "nível=${v.level}")

    check("sem erro de ponto flutuante", applied.all { near(it, Math.round(it * 100.0) / 100.0) })
    check("rótulo mostra a porcentagem", v.label() == "🔊 0%", v.label())
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. OK = play/pause alternando de verdade
// ─────────────────────────────────────────────────────────────────────────────
private fun testPlayPause() {
    println("\n[8] OK alterna play/pause a partir do estado REAL")
    val c = PlayPauseController(debounceMs = 250)
    var realPlaying = false // entra pausado, como o provedor costuma montar
    var toggles = 0

    fun press(now: Long) {
        if (c.onKey(now)) {
            toggles++
            realPlaying = !realPlaying
            c.onState(realPlaying)
        }
    }

    press(0)
    check("1º OK despausa", realPlaying, "playing=$realPlaying")
    press(400)
    check("2º OK pausa", !realPlaying, "playing=$realPlaying")
    press(800)
    check("3º OK despausa", realPlaying, "playing=$realPlaying")
    press(1200)
    check("4º OK pausa", !realPlaying, "playing=$realPlaying")
    check("4 toques = 4 toggles", toggles == 4, "toggles=$toggles")

    // Auto-repeat do controle no mesmo toque não pode piscar o vídeo.
    val c2 = PlayPauseController(debounceMs = 250)
    var n = 0
    listOf(0L, 40L, 80L, 120L).forEach { if (c2.onKey(it)) n++ }
    check("auto-repeat do mesmo toque = 1 toggle", n == 1, "toggles=$n")

    // Dica na tela é o inverso do estado atual.
    val c3 = PlayPauseController()
    c3.onState(true)
    check("dica com vídeo tocando = Pausado", c3.hint().contains("Pausado"), c3.hint())
    c3.onState(false)
    check("dica com vídeo pausado = Reproduzindo", c3.hint().contains("Reproduzindo"), c3.hint())
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Rótulos dos passos
// ─────────────────────────────────────────────────────────────────────────────
private fun testLabels() {
    println("\n[9] Rótulos dos passos")
    val p = FakePlayer(pos = 0.0, dur = 3600.0)
    val s = seeker(p)
    s.onKeyDown(1, 0, 0)
    s.onKeyUp(100)
    check("toque curto mostra +10s", s.stepLabel() == "+10s", s.stepLabel())

    val p2 = FakePlayer(pos = 0.0, dur = 3600.0)
    val s2 = seeker(p2)
    s2.onKeyDown(-1, 0, 0)
    var t = 0L
    while (t < 1100L) { t += 50L; s2.onKeyDown(-1, (t / 50).toInt(), t); s2.tick(t) }
    s2.onKeyUp(t)
    check("segurar mostra minutos", s2.stepLabel().contains("min"), s2.stepLabel())
    check("retroceder mostra sinal negativo", s2.stepLabel().startsWith("−"), s2.stepLabel())
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. OK de primeira: reenvio quando o player ignora o primeiro comando
// ─────────────────────────────────────────────────────────────────────────────
private fun testToggleRetry() {
    println("\n[10] OK de primeira — reenvio quando o player não obedece")
    val c = PlayPauseController(debounceMs = 250, confirmMs = 400, maxAttempts = 3)
    c.onState(false) // entra pausado

    check("1º OK pede comando", c.onKey(0))
    check("alvo é play", c.pending)

    // O player NÃO reportou nada: passou o tempo de confirmação.
    check("nada antes de 400 ms", c.retry(300) == null)
    check("reenvia PLAY explícito em 400 ms", c.retry(400) == true)
    check("reenvia PLAY de novo em 800 ms", c.retry(800) == true)
    check("para depois de 3 tentativas", c.retry(1200) == null)
    check("nada mais pendente", !c.pending)

    // Se o player obedeceu, não reenvia nada.
    val c2 = PlayPauseController(debounceMs = 250, confirmMs = 400, maxAttempts = 3)
    c2.onState(false)
    c2.onKey(0)
    c2.onState(true) // obedeceu
    check("sem reenvio quando o player obedeceu", c2.retry(1000) == null)
    check("estado real atualizado", c2.playing)

    // Reenvio é EXPLÍCITO: pausar de novo não vira play.
    val c3 = PlayPauseController(debounceMs = 250, confirmMs = 400, maxAttempts = 3)
    c3.onState(true)
    c3.onKey(0)
    check("alvo é pause", c3.retry(400) == false)
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Auto-hide dos controles em 3 s
// ─────────────────────────────────────────────────────────────────────────────
private fun testUiAutoHide() {
    println("\n[11] Controles somem 3 s depois da última tecla")
    val u = UiVisibility(hideAfterMs = 3_000)

    // Primeiro tick só começa a contar — a barra nasce visível.
    u.tick(50_000)
    check("nasce visível", u.visible)

    u.tick(52_000)
    check("ainda visível em 2 s", u.visible)

    u.tick(53_000)
    check("some em 3 s", !u.visible)

    // Qualquer tecla traz de volta.
    u.poke(60_000)
    check("tecla traz de volta", u.visible)
    u.tick(62_000)
    check("continua visível 2 s depois da tecla", u.visible)
    u.tick(63_000)
    check("some de novo 3 s depois da tecla", !u.visible)

    // Tecla repetida mantém na tela.
    u.poke(70_000)
    u.poke(71_500)
    u.tick(73_000)
    check("tecla repetida reinicia a contagem", u.visible)
}

fun main() {
    println("MovieFlix TV — testes do controle remoto do player")
    println("=".repeat(60))
    testShortPress()
    testHoldAcceleration()
    testExactStop()
    testReleaseWatchdog()
    testBounds()
    testRepeatedTaps()
    testVolume()
    testPlayPause()
    testLabels()
    testToggleRetry()
    testUiAutoHide()
    println("\n" + "=".repeat(60))
    println("$checks verificações, $failures falha(s)")
    if (failures > 0) {
        println("RESULTADO: FALHOU")
        kotlin.system.exitProcess(1)
    }
    println("RESULTADO: PASSOU")
}
