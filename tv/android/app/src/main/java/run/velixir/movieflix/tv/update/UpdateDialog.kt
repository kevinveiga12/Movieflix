package run.velixir.movieflix.tv.update

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfSans

/**
 * Janela de atualização disponível.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CAUSA RAIZ DOS DOIS PROBLEMAS RELATADOS (e por que a correção é esta)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 1) O CONTROLE REMOTO CONTINUAVA CONTROLANDO A TELA DE TRÁS.
 *
 *    A versão anterior era um `Dialog` do Compose. No Android TV o `Dialog` cria
 *    uma janela separada, mas o Compose NÃO transfere a posse do foco para ela:
 *    o `AndroidComposeView` da Activity continua sendo o dono do foco. Resultado
 *    medido no aparelho: o D-pad seguia navegando nos cards e no menu lateral
 *    atrás do véu, e o OK não acionava nada na janela.
 *
 *    Antes disso a janela era um `Box` sobreposto na MESMA composição — e o
 *    problema era o mesmo, porque nada dentro dela era focável.
 *
 *    A correção não depende mais de semântica de janela: a janela é um overlay
 *    de tela cheia que (a) PEDE o foco para si (`focusRequester` + `focusable`)
 *    e (b) REGISTRA um tratador na raiz do app (`UpdateKeyRouter`), que consome
 *    toda tecla na fase de preview, antes de qualquer tela. Como o Compose tem
 *    um único dono de foco, pedir o foco para o overlay tira o foco do app de
 *    trás; e como a raiz consome tudo enquanto o tratador existe, nenhuma tecla
 *    chega ao MovieFlix que está atrás. As duas garantias são independentes —
 *    se uma falhar, a outra segura.
 *
 * 2) O CONTEÚDO FICAVA CORTADO EMBAIXO E NÃO DAVA PARA DESCER.
 *
 *    O cartão tinha `width(720.dp)` e ALTURA LIVRE: quando o texto passava da
 *    altura da TV, o excedente era simplesmente cortado pelo limite da janela,
 *    sem rolagem nenhuma. Os botões ficavam fora da área visível.
 *
 *    Agora o cartão é dimensionado a partir do tamanho REAL da TV
 *    (`BoxWithConstraints`), com margens de segurança, e o corpo do texto vive
 *    num `verticalScroll` com `weight(1f)`. Os botões ficam FORA da área que
 *    rola, ancorados no rodapé do cartão: eles nunca saem da tela, e o texto
 *    rola por cima deles.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * NAVEGAÇÃO
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Toda a regra de navegação (o que cada seta faz, quando o conteúdo rola, como
 * se chega aos botões) mora em `UpdateNav` — uma classe pura, sem Android, com
 * teste automatizado. Esta tela só desenha o estado que ela devolve.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O QUE A JANELA NÃO FAZ
 * ══════════════════════════════════════════════════════════════════════════════
 * Não instala nada sozinha. Ela baixa o APK, valida o SHA-256 e abre o
 * instalador do Android — que SEMPRE pede confirmação do usuário. Instalação
 * silenciosa exigiria root e não é prometida em lugar nenhum.
 *
 * Instalar por cima (mesmo applicationId + mesma assinatura) preserva login,
 * sessão e dados locais: o app não limpa armazenamento em nenhum momento.
 */

/**
 * Roteador de teclas da janela de atualização.
 *
 * Enquanto a janela está aberta, ela registra aqui o seu tratador, e o `Box`
 * raiz do app consulta este registro ANTES de qualquer outra coisa. Com um
 * tratador registrado, TODA tecla é consumida na raiz — o MovieFlix de trás não
 * recebe nada, nem setas, nem OK, nem BACK. Quando a janela fecha, o registro é
 * limpo e o app volta ao normal.
 *
 * É a segunda camada de proteção, independente do foco: mesmo que o sistema não
 * entregue o foco ao overlay, o controle remoto não vaza para o app de trás.
 */
object UpdateKeyRouter {
    /** Tratador ativo, ou `null` quando não há janela aberta. */
    var handler: ((Key) -> Unit)? = null
        private set

    fun register(h: (Key) -> Unit) {
        handler = h
    }

    fun unregister() {
        handler = null
    }

    /** `true` = a tecla foi consumida e não deve chegar ao app de trás. */
    fun dispatch(key: Key): Boolean {
        val h = handler ?: return false
        h(key)
        // Consome SEMPRE enquanto a janela existe, mesmo que o tratador não
        // reconheça a tecla: nada vaza para o MovieFlix.
        return true
    }
}

/** Traduz a tecla do Compose para a tecla do núcleo de navegação. */
private fun paraTeclaNav(key: Key): UpdateNav.Tecla? = when (key) {
    Key.DirectionUp -> UpdateNav.Tecla.Up
    Key.DirectionDown -> UpdateNav.Tecla.Down
    Key.DirectionLeft -> UpdateNav.Tecla.Left
    Key.DirectionRight -> UpdateNav.Tecla.Right
    Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> UpdateNav.Tecla.Ok
    Key.Back -> UpdateNav.Tecla.Back
    else -> null
}

@Composable
fun UpdateDialog(
    manifest: UpdateManager.Manifest,
    installedVersion: String,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    /*
      O Context do Compose pode ser um ContextWrapper, não a Activity. Subir a
      árvore é obrigatório: `startActivity` do instalador e a checagem de
      "instalar apps desconhecidos" precisam da Activity real.
    */
    val activity = remember(context) {
        var c: android.content.Context? = context
        while (c is android.content.ContextWrapper && c !is android.app.Activity) {
            c = c.baseContext
        }
        c as? android.app.Activity
    }

    var downloading by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var permissionNeeded by remember { mutableStateOf(false) }

    val scroll = rememberScrollState()

    /*
      O núcleo de navegação é recriado quando o tamanho do conteúdo ou da área
      visível muda (ex.: as notas terminam de medir). O estado que importa para
      o usuário — alvo e rolagem — é preservado entre recriações.
    */
    var nav by remember { mutableStateOf<UpdateNav?>(null) }
    var alvo by remember { mutableStateOf(UpdateNav.Alvo.Conteudo) }

    /*
      Foco inicial.

      O overlay pede o foco para si dois frames depois da composição — quando o
      nó já existe na árvore. É o que tira o foco do app de trás. Se falhar
      (raro), a interceptação de teclas na raiz continua valendo, então o
      controle remoto ainda não vaza para o MovieFlix.
    */
    val rootFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        withFrameNanos { }
        runCatching { rootFocus.requestFocus() }
    }

    /** Baixa, valida o hash e abre o instalador. */
    fun startDownload() {
        downloading = true
        progress = 0
        error = null
        nav?.setDownloading(true)
        alvo = UpdateNav.Alvo.Conteudo
        scope.launch {
            try {
                val apk = UpdateManager.download(context, manifest) { p -> progress = p }
                downloading = false
                nav?.setDownloading(false)
                val opened = activity?.let { UpdateManager.install(it, apk) } ?: false
                if (!opened) {
                    permissionNeeded = true
                    alvo = UpdateNav.Alvo.Primario
                }
            } catch (e: Exception) {
                downloading = false
                nav?.setDownloading(false)
                error = e.message ?: "Falha ao baixar a atualização."
                alvo = UpdateNav.Alvo.Primario
            }
        }
    }

    /* Rótulo do botão primário, conforme o estado atual. */
    val primarioLabel = if (error != null) "TENTAR NOVAMENTE" else "ATUALIZAR AGORA"
    val primarioAcao: () -> Unit = {
        if (permissionNeeded) permissionNeeded = false
        startDownload()
    }
    val temSecundario = !manifest.mandatory && !downloading

    /**
     * Trata uma tecla: entrega ao núcleo, aplica o resultado e devolve a ação.
     *
     * A UI SEMPRE consome a tecla, qualquer que seja o resultado — é isso que
     * impede o MovieFlix de trás de receber comandos enquanto a janela existe.
     */
    fun tratarTecla(key: Key) {
        val n = nav ?: return
        val tecla = paraTeclaNav(key) ?: return
        val acao = n.onKey(tecla)
        alvo = n.alvo
        // A rolagem do núcleo é a fonte da verdade; a do Compose só a segue.
        scope.launch { scroll.animateScrollTo(n.scroll) }
        when (acao) {
            UpdateNav.Acao.Fechar -> onDismiss()
            UpdateNav.Acao.AcionarPrimario -> if (!downloading) primarioAcao()
            UpdateNav.Acao.AcionarSecundario -> if (temSecundario) onDismiss()
            UpdateNav.Acao.Nenhuma -> Unit
        }
    }

    /*
      Registra o tratador na raiz enquanto a janela existir.

      `DisposableEffect` garante o par: registra ao entrar na composição e
      desregistra ao sair (inclusive se a janela for descartada por uma
      recomposição). Sem o desregistro, o app ficaria "surdo" ao controle
      remoto depois de fechar a atualização.
    */
    DisposableEffect(Unit) {
        UpdateKeyRouter.register { key -> tratarTecla(key) }
        onDispose { UpdateKeyRouter.unregister() }
    }

    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(Color(0xF2000000))
            /*
              O overlay é o dono do foco e o dono das teclas. `onPreviewKeyEvent`
              roda ANTES de qualquer filho, então nada escapa para o app de trás.
            */
            .focusRequester(rootFocus)
            .focusable()
            .onPreviewKeyEvent { ev ->
                if (ev.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                tratarTecla(ev.key)
                true
            },
        contentAlignment = Alignment.Center,
    ) {
        /*
          Dimensionamento a partir da TV REAL.

          Margens de 4% da largura e 5% da altura deixam respiro em 720p, 1080p e
          4K, e em telas com overscan. A largura é limitada a 900dp para o texto
          não virar uma linha longa demais em 4K.
        */
        val larguraCartao = (maxWidth * 0.92f).coerceAtMost(900.dp)
        val alturaCartao = maxHeight * 0.90f

        Column(
            Modifier
                .width(larguraCartao)
                .height(alturaCartao)
                .clip(RoundedCornerShape(18.dp))
                .background(MfColors.BgCard)
                .border(1.dp, MfColors.Border, RoundedCornerShape(18.dp))
                .padding(horizontal = 36.dp, vertical = 28.dp),
        ) {
            /* ── Corpo rolável ─────────────────────────────────────────────── */
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(scroll),
            ) {
                Text(
                    "ATUALIZAÇÃO DISPONÍVEL!",
                    color = MfColors.Red,
                    fontFamily = MfSans,
                    fontSize = 26.sp,
                    fontWeight = FontWeight.ExtraBold,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "Deseja atualizar agora?",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Uma nova versão do MovieFlix TV está disponível. Seus dados e seu login são mantidos.",
                    color = MfColors.TextSoft,
                    fontFamily = MfSans,
                    fontSize = 15.sp,
                )
                Spacer(Modifier.height(18.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    VersionBadge("Instalada", installedVersion)
                    VersionBadge("Nova versão", manifest.version)
                }

                if (manifest.notes.isNotEmpty()) {
                    Spacer(Modifier.height(22.dp))
                    Text(
                        "Novidades",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(8.dp))
                    /*
                      TODAS as notas, sem `take(n)`. O pedido é explícito: não
                      esconder informação para caber — o texto rola.
                    */
                    manifest.notes.forEach { note ->
                        Text(
                            "•  $note",
                            color = MfColors.TextSoft,
                            fontFamily = MfSans,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(vertical = 3.dp),
                        )
                    }
                }

                if (downloading) {
                    Spacer(Modifier.height(22.dp))
                    Text(
                        "Baixando… $progress%",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(10.dp))
                    LinearProgressIndicator(
                        progress = { progress / 100f },
                        modifier = Modifier.fillMaxWidth().height(8.dp),
                        color = MfColors.Red,
                        trackColor = MfColors.BgHover,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Não desligue a TV. O instalador do Android abre em seguida.",
                        color = MfColors.TextDim,
                        fontFamily = MfSans,
                        fontSize = 13.sp,
                    )
                }

                if (error != null) {
                    Spacer(Modifier.height(18.dp))
                    Text(
                        error!!,
                        color = MfColors.Red,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                    )
                }

                if (permissionNeeded) {
                    Spacer(Modifier.height(18.dp))
                    Text(
                        "Permita a instalação de apps desta fonte e escolha ATUALIZAR AGORA novamente.",
                        color = MfColors.TextSoft,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                    )
                }

                Spacer(Modifier.height(8.dp))
            }

            /* ── Rodapé fixo: os botões NUNCA saem da tela ─────────────────── */
            if (!downloading) {
                Spacer(Modifier.height(14.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    UpdateButton(
                        label = primarioLabel,
                        primary = true,
                        focused = alvo == UpdateNav.Alvo.Primario,
                        onClick = primarioAcao,
                    )
                    if (temSecundario) {
                        UpdateButton(
                            label = "DEPOIS",
                            primary = false,
                            focused = alvo == UpdateNav.Alvo.Secundario,
                            onClick = onDismiss,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        if (alvo == UpdateNav.Alvo.Conteudo) "▼ role com as setas"
                        else "OK seleciona · ↑ volta ao texto",
                        color = MfColors.TextDim,
                        fontFamily = MfSans,
                        fontSize = 12.sp,
                        textAlign = TextAlign.End,
                    )
                }
            }
        }

        /*
          O núcleo de navegação precisa das medidas REAIS para decidir quando o
          conteúdo acabou. Ele é (re)criado aqui, quando as medidas mudam, e o
          estado visível (alvo/rolagem) é reaplicado logo em seguida.
        */
        val contentPx = scroll.maxValue + scroll.viewportSize
        LaunchedEffect(contentPx, scroll.viewportSize, temSecundario) {
            val n = UpdateNav(
                contentHeight = contentPx,
                viewportHeight = scroll.viewportSize,
                hasSecondary = temSecundario,
                mandatory = manifest.mandatory,
            )
            n.setDownloading(downloading)
            n.restaurar(alvo, scroll.value)
            nav = n
        }
    }
}

/** Rótulo + valor de versão (instalada / nova). */
@Composable
private fun VersionBadge(label: String, value: String) {
    Column {
        Text(
            label,
            color = MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 12.sp,
        )
        Text(
            value,
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

/**
 * Botão da janela.
 *
 * O destaque NÃO vem do foco do Compose: vem do índice que a janela controla
 * (`focused`). Assim o realce é determinístico e não depende de o sistema
 * entregar o foco para o nó certo — que era justamente o que falhava na TV.
 *
 * `clickable` continua existindo para toque (controle com ponteiro / mouse).
 */
@Composable
private fun UpdateButton(
    label: String,
    primary: Boolean,
    focused: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    focused -> MfColors.RedBright
                    primary -> MfColors.Red
                    else -> MfColors.BgHover
                },
            )
            .border(
                if (focused) 3.dp else 1.dp,
                if (focused) Color.White else Color.Transparent,
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 26.dp, vertical = 14.dp),
    ) {
        Text(
            label,
            color = Color.White,
            fontFamily = MfSans,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
    }
}
