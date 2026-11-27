package run.velixir.movieflix.tv.update

/**
 * Teste do núcleo de navegação da janela de atualização.
 *
 * Roda a MESMA lógica que a TV executa, tecla por tecla, e prova o que o
 * usuário pediu:
 *
 *   · as setas para cima e para baixo navegam E rolam o conteúdo;
 *   · dá para chegar aos botões de baixo (ATUALIZAR AGORA / DEPOIS);
 *   · o OK seleciona o elemento em foco;
 *   · o BACK fecha quando é opcional e é bloqueado quando é obrigatório;
 *   · durante o download o BACK não fecha.
 *
 * Sem dependência de Android: é Kotlin puro, então roda em qualquer lugar.
 */
object UpdateNavCheck {

    private var falhas = 0
    private var total = 0

    private fun ok(cond: Boolean, msg: String) {
        total++
        if (!cond) {
            falhas++
            println("  FALHOU: $msg")
        }
    }

    /** Simula uma TV 1080p: área visível de 600px, texto de 2000px. */
    private fun nav(
        content: Int = 2000,
        viewport: Int = 600,
        secondary: Boolean = true,
        mandatory: Boolean = false,
    ) = UpdateNav(content, viewport, secondary, mandatory)

    @JvmStatic
    fun main(args: Array<String>) {
        println("== UpdateNav: navegação da janela de atualização ==")

        // ── 1. O conteúdo rola com as setas ──────────────────────────────────
        run {
            val n = nav()
            ok(n.maxScroll == 1400, "maxScroll deve ser 1400 (2000-600), veio ${n.maxScroll}")
            ok(n.scroll == 0, "começa no topo")
            n.onKey(UpdateNav.Tecla.Down)
            ok(n.scroll > 0, "↓ rola o conteúdo para baixo")
            val depoisDeUm = n.scroll
            n.onKey(UpdateNav.Tecla.Down)
            val depoisDeDois = n.scroll
            ok(depoisDeDois > depoisDeUm, "↓ continua rolando")
            n.onKey(UpdateNav.Tecla.Up)
            ok(n.scroll < depoisDeDois, "↑ rola de volta para cima")
            ok(n.scroll == depoisDeUm, "↑ desfaz exatamente um passo de rolagem")
        }

        // ── 2. Rolar até o fim e chegar ao botão primário ────────────────────
        run {
            val n = nav()
            var guard = 0
            while (n.scroll < n.maxScroll && guard++ < 100) n.onKey(UpdateNav.Tecla.Down)
            ok(n.scroll == n.maxScroll, "chega ao fim da rolagem")
            ok(n.alvo == UpdateNav.Alvo.Conteudo, "ainda no conteúdo no fim da rolagem")
            n.onKey(UpdateNav.Tecla.Down)
            ok(n.alvo == UpdateNav.Alvo.Primario, "↓ no fim da rolagem vai para o botão primário")
        }

        // ── 3. Chegar ao botão secundário e voltar ───────────────────────────
        run {
            val n = nav()
            var guard = 0
            while (n.alvo != UpdateNav.Alvo.Primario && guard++ < 100) n.onKey(UpdateNav.Tecla.Down)
            ok(n.alvo == UpdateNav.Alvo.Primario, "alcança o primário")
            n.onKey(UpdateNav.Tecla.Down)
            ok(n.alvo == UpdateNav.Alvo.Secundario, "↓ alcança o secundário (DEPOIS)")
            n.onKey(UpdateNav.Tecla.Up)
            ok(n.alvo == UpdateNav.Alvo.Primario, "↑ volta ao primário")
            n.onKey(UpdateNav.Tecla.Up)
            ok(n.alvo == UpdateNav.Alvo.Conteudo, "↑ no primário volta ao conteúdo")
        }

        // ── 4. ← / → alternam entre os botões ────────────────────────────────
        run {
            val n = nav()
            var guard = 0
            while (n.alvo != UpdateNav.Alvo.Primario && guard++ < 100) n.onKey(UpdateNav.Tecla.Down)
            n.onKey(UpdateNav.Tecla.Right)
            ok(n.alvo == UpdateNav.Alvo.Secundario, "→ vai para o secundário")
            n.onKey(UpdateNav.Tecla.Left)
            ok(n.alvo == UpdateNav.Alvo.Primario, "← volta para o primário")
        }

        // ── 5. OK aciona o elemento em foco ──────────────────────────────────
        run {
            val n = nav()
            var guard = 0
            while (n.alvo != UpdateNav.Alvo.Primario && guard++ < 100) n.onKey(UpdateNav.Tecla.Down)
            ok(n.onKey(UpdateNav.Tecla.Ok) == UpdateNav.Acao.AcionarPrimario, "OK no primário aciona")
            n.onKey(UpdateNav.Tecla.Down)
            ok(n.onKey(UpdateNav.Tecla.Ok) == UpdateNav.Acao.AcionarSecundario, "OK no secundário aciona")
        }

        // ── 6. OK no conteúdo rola, não aciona nada ──────────────────────────
        run {
            val n = nav()
            val antes = n.scroll
            val acao = n.onKey(UpdateNav.Tecla.Ok)
            ok(acao == UpdateNav.Acao.Nenhuma, "OK no conteúdo não aciona botão")
            ok(n.scroll > antes, "OK no conteúdo avança a rolagem")
        }

        // ── 7. BACK: opcional fecha, obrigatório não ─────────────────────────
        run {
            val opcional = nav(mandatory = false)
            ok(opcional.onKey(UpdateNav.Tecla.Back) == UpdateNav.Acao.Fechar, "BACK fecha quando opcional")
            val obrigatoria = nav(mandatory = true)
            ok(obrigatoria.onKey(UpdateNav.Tecla.Back) == UpdateNav.Acao.Nenhuma, "BACK bloqueado quando obrigatória")
        }

        // ── 8. Durante o download: sem botões e BACK ignorado ────────────────
        run {
            val n = nav()
            n.setDownloading(true)
            ok(n.alvo == UpdateNav.Alvo.Conteudo, "download volta o foco ao conteúdo")
            ok(n.onKey(UpdateNav.Tecla.Back) == UpdateNav.Acao.Nenhuma, "BACK ignorado durante o download")
            var guard = 0
            while (n.scroll < n.maxScroll && guard++ < 100) n.onKey(UpdateNav.Tecla.Down)
            n.onKey(UpdateNav.Tecla.Down)
            ok(n.alvo == UpdateNav.Alvo.Conteudo, "durante o download ↓ não vai para botão inexistente")
        }

        // ── 9. Atualização obrigatória: sem botão secundário ─────────────────
        run {
            val n = nav(secondary = false, mandatory = true)
            var guard = 0
            while (n.alvo != UpdateNav.Alvo.Primario && guard++ < 100) n.onKey(UpdateNav.Tecla.Down)
            ok(n.alvo == UpdateNav.Alvo.Primario, "alcança o primário sem secundário")
            n.onKey(UpdateNav.Tecla.Down)
            ok(n.alvo == UpdateNav.Alvo.Primario, "↓ não vai a um secundário que não existe")
            n.onKey(UpdateNav.Tecla.Right)
            ok(n.alvo == UpdateNav.Alvo.Primario, "→ não vai a um secundário que não existe")
        }

        // ── 10. Conteúdo que cabe na tela: ↓ vai direto ao botão ─────────────
        run {
            val n = nav(content = 400, viewport = 600)
            ok(n.maxScroll == 0, "sem rolagem quando o texto cabe")
            n.onKey(UpdateNav.Tecla.Down)
            ok(n.alvo == UpdateNav.Alvo.Primario, "↓ vai direto ao botão quando não há o que rolar")
        }

        // ── 11. ↑ no topo não sai do conteúdo ────────────────────────────────
        run {
            val n = nav()
            n.onKey(UpdateNav.Tecla.Up)
            ok(n.scroll == 0, "↑ no topo mantém a rolagem em 0")
            ok(n.alvo == UpdateNav.Alvo.Conteudo, "↑ no topo mantém o foco no conteúdo")
        }

        println("== $total verificações, $falhas falha(s) ==")
        if (falhas > 0) {
            throw AssertionError("$falhas verificação(ões) falharam")
        }
        println("RESULTADO: PASSOU")
    }
}
