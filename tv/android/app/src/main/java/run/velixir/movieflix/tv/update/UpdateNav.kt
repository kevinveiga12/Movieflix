package run.velixir.movieflix.tv.update

/**
 * Núcleo de navegação da janela de atualização.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA CLASSE EXISTE SEPARADA DA UI
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * O comportamento que o usuário pediu — "as setas navegam e rolam, o OK
 * seleciona, dá para chegar aos botões de baixo" — é uma máquina de estados
 * pequena e determinística. Deixá-la aqui, sem nenhuma dependência de Android
 * ou Compose, permite TESTÁ-LA de verdade: o teste roda a mesma lógica que a TV
 * executa, tecla por tecla, e prova que os botões são alcançáveis e que o
 * conteúdo rola até o fim.
 *
 * A UI (`UpdateDialog`) só desenha o resultado: qual elemento está em foco e
 * onde a rolagem está. Nenhuma regra de navegação mora na UI.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * MODELO
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   CONTEÚDO  ──↓ (no fim da rolagem)──▶  PRIMÁRIO  ──↓──▶  SECUNDÁRIO
 *      ▲                                    │  ◀──→  │
 *      └──────────── ↑ ─────────────────────┘         │
 *      └──────────────── ↑ ───────────────────────────┘
 *
 *   · ↑/↓ no CONTEÚDO rolam o texto. Ao chegar no fim, ↓ vai para o 1º botão.
 *   · ↑/↓ nos botões trocam de botão; ↑ no 1º botão volta ao conteúdo.
 *   · ←/→ alternam entre os botões.
 *   · OK/ENTER aciona o elemento em foco (no conteúdo, avança a rolagem).
 *   · BACK fecha quando a atualização é opcional; é ignorado durante o download
 *     e bloqueado quando a atualização é obrigatória.
 */
class UpdateNav(
    /** Altura total do texto, em pixels. */
    private val contentHeight: Int,
    /** Altura da área visível, em pixels. */
    private val viewportHeight: Int,
    /** Existe o botão secundário ("DEPOIS")? Não existe em atualização obrigatória. */
    private val hasSecondary: Boolean,
    /** Atualização obrigatória: BACK não fecha. */
    private val mandatory: Boolean,
) {
    /** Elemento em foco. */
    enum class Alvo { Conteudo, Primario, Secundario }

    /** Ação que a UI deve executar depois de uma tecla. */
    enum class Acao { Nenhuma, Fechar, AcionarPrimario, AcionarSecundario }

    var alvo: Alvo = Alvo.Conteudo
        private set

    /** Posição da rolagem, em pixels (0 = topo). */
    var scroll: Int = 0
        private set

    /**
     * Restaura o estado visível depois de uma recriação.
     *
     * O núcleo é recriado quando as medidas reais do texto chegam (o conteúdo
     * termina de medir depois do primeiro frame). Sem isto, o foco e a rolagem
     * voltariam ao topo a cada medição — o usuário veria a janela "pular".
     */
    fun restaurar(alvo: Alvo, scroll: Int) {
        this.alvo = alvo
        this.scroll = scroll.coerceIn(0, maxScroll)
    }

    /** Baixando: os botões somem e o BACK é ignorado. */
    var downloading: Boolean = false
        private set

    val maxScroll: Int get() = (contentHeight - viewportHeight).coerceAtLeast(0)

    /** Uma "página" de rolagem por toque — previsível a 3 metros de distância. */
    private val passo: Int get() = (viewportHeight * 0.8f).toInt().coerceAtLeast(1)

    fun setDownloading(v: Boolean) {
        downloading = v
        if (v) alvo = Alvo.Conteudo
    }

    /** O botão secundário está disponível agora? */
    private val secundarioDisponivel: Boolean get() = hasSecondary && !downloading

    private fun rolar(paraBaixo: Boolean) {
        scroll = if (paraBaixo) (scroll + passo).coerceAtMost(maxScroll)
        else (scroll - passo).coerceAtLeast(0)
    }

    private fun irPara(destino: Alvo) {
        alvo = destino
        // Os botões ficam ancorados no rodapé: rolar até o fim mostra o texto
        // imediatamente acima deles, sem "pular" a leitura.
        if (destino != Alvo.Conteudo) scroll = maxScroll
    }

    /**
     * Trata uma tecla e devolve a ação que a UI deve executar.
     *
     * A UI SEMPRE consome a tecla, qualquer que seja o retorno — é isso que
     * impede o MovieFlix de trás de receber comandos enquanto a janela existe.
     */
    fun onKey(key: Tecla): Acao {
        when (key) {
            Tecla.Back -> {
                if (downloading) return Acao.Nenhuma
                if (!mandatory) return Acao.Fechar
                return Acao.Nenhuma
            }

            Tecla.Up -> {
                when (alvo) {
                    Alvo.Conteudo -> if (scroll > 0) rolar(false)
                    Alvo.Primario -> irPara(Alvo.Conteudo)
                    Alvo.Secundario -> irPara(Alvo.Primario)
                }
                return Acao.Nenhuma
            }

            Tecla.Down -> {
                when (alvo) {
                    Alvo.Conteudo -> {
                        if (scroll < maxScroll) rolar(true)
                        else if (!downloading) irPara(Alvo.Primario)
                    }
                    Alvo.Primario -> if (secundarioDisponivel) irPara(Alvo.Secundario)
                    Alvo.Secundario -> Unit
                }
                return Acao.Nenhuma
            }

            Tecla.Left -> {
                if (alvo == Alvo.Secundario) irPara(Alvo.Primario)
                return Acao.Nenhuma
            }

            Tecla.Right -> {
                if (alvo == Alvo.Primario && secundarioDisponivel) irPara(Alvo.Secundario)
                return Acao.Nenhuma
            }

            Tecla.Ok -> {
                return when (alvo) {
                    // No conteúdo o OK avança a leitura; não há o que "acionar".
                    Alvo.Conteudo -> {
                        if (scroll < maxScroll) rolar(true)
                        Acao.Nenhuma
                    }
                    Alvo.Primario -> if (downloading) Acao.Nenhuma else Acao.AcionarPrimario
                    Alvo.Secundario -> if (secundarioDisponivel) Acao.AcionarSecundario else Acao.Nenhuma
                }
            }
        }
    }

    /** Teclas que a janela reconhece. */
    enum class Tecla { Up, Down, Left, Right, Ok, Back }
}
