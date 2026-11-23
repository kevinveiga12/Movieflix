package run.velixir.movieflix.tv.ui.screens

import android.annotation.SuppressLint
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import org.json.JSONObject
import run.velixir.movieflix.tv.TvViewModel
import run.velixir.movieflix.tv.data.Title
import run.velixir.movieflix.tv.player.HoldDetector
import run.velixir.movieflix.tv.player.PlayPauseController
import run.velixir.movieflix.tv.player.SeekController
import run.velixir.movieflix.tv.player.UiVisibility
import run.velixir.movieflix.tv.ui.theme.MfColors

/**
 * Player da TV — versão "limpa".
 *
 * ── O que o proprietário pediu (e é a regra deste arquivo) ───────────────────
 *
 *   a) o vídeo começa sozinho ao abrir o filme/série;
 *   b) na tela aparece SOMENTE a barra de progresso — nada de botões, ícones,
 *      textos, títulos, painéis, bordas, molduras ou anel de foco;
 *   c) OK pausa; OK de novo despausa; e assim sempre;
 *   d) ← e → retrocedem/avançam de verdade;
 *   e) Voltar sai do player (e, em tela cheia, sai da tela cheia primeiro);
 *   f) o foco NUNCA sai do player nem revela elementos escondidos;
 *   g) segurar OK entra/sai da TELA CHEIA (só o vídeo, sem barra e sem UI).
 *
 * ── TELA CHEIA: por que o botão do provedor não serve ──────────────────────
 *
 * O botão de tela cheia do player azul chama `requestFullscreen()`. O WebView do
 * Android RECUSA esse pedido em silêncio quando ele vem de um iframe de outra
 * origem — a cadeia myembed.biz → playerflix.ink → frame do vídeo nunca tem
 * todos os elos com `allow="fullscreen"`. Por isso o clique não fazia nada.
 *
 * A solução não depende do provedor: a ponte põe o `<video>` cobrindo a janela
 * inteira (`window.__mfCmd('fullscreen', 1)`) e nós escondemos a barra e as
 * barras do sistema. A UI do provedor já está escondida sempre — então, em tela
 * cheia, sobra literalmente só o vídeo.
 *
 * ── Causa raiz da borda amarela e do OK "não funcionar" ──────────────────────
 *
 * O player do provedor roda dentro de um WebView. Na versão anterior o WebView
 * era FOCÁVEL (`isFocusable = true`, `requestFocus()`), então ele recebia o
 * D-pad. Dentro dele, o navegador fazia a navegação de foco do DOM: cada OK
 * movia o foco para o próximo elemento focável da página do provedor (o painel
 * "ASSISTIR", a engrenagem, o ícone de tela cheia…) e o Chromium desenhava o
 * anel de foco amarelo em volta dele — exatamente a borda do canto superior
 * direito das fotos. Como o foco estava no DOM e não no nosso player, o OK
 * deixava de chegar ao nosso handler: era preciso apertar várias vezes.
 *
 * Correção (a causa, não o sintoma):
 *   1. o WebView deixa de ser focável e bloqueia o foco dos descendentes
 *      (`FOCUS_BLOCK_DESCENDANTS`) — ele nunca mais recebe o D-pad;
 *   2. o D-pad é tratado no Box do Compose que envolve o WebView, que é o
 *      único elemento focável da tela;
 *   3. a ponte JS apaga qualquer `outline`/anel de foco, para que nem um
 *      `focus()` vindo do próprio provedor desenhe borda;
 *   4. a UI do provedor é escondida SEMPRE (não só quando o `<video>` é
 *      encontrado), então não sobra nada para o foco revelar.
 *
 * ── Por que a ponte JS existe ────────────────────────────────────────────────
 *
 * O `<video>` do provedor está num iframe de outra origem; a página do
 * MovieFlix não o alcança. No Android, `addDocumentStartJavaScript` injeta o
 * script em TODOS os frames, inclusive de outra origem — é por ele que
 * controlamos o `<video>` real (`play`, `pause`, `currentTime`), e não um
 * ícone mudando de estado.
 */
@Composable
fun TvPlayerScreen(
    vm: TvViewModel,
    title: Title,
    season: Int?,
    episode: Int?,
    onBack: () -> Unit,
    onLoginRequired: () -> Unit = {},
) {
    var url by remember { mutableStateOf<String?>(null) }
    var mode by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }

    /*
      Trava de segurança do login obrigatório.

      A navegação (MainActivity) já manda ao login antes de chegar aqui, mas o
      player também confere por conta própria: se a sessão cair no meio do
      caminho (token expirado, logout em outro aparelho), ele NÃO abre o vídeo —
      chama onLoginRequired e a pessoa vai para a tela de login. Sem isso, um
      estado deslogado ainda conseguia montar o player e "assistir".
    */
    val st by vm.state.collectAsState()
    LaunchedEffect(st.loggedIn) {
        if (!st.loggedIn) onLoginRequired()
    }

    LaunchedEffect(title.tmdbId, season, episode, st.loggedIn) {
        if (!st.loggedIn) {
            loading = false
            return@LaunchedEffect
        }
        vm.authorize(title.tmdbId, season, episode) { u, m, msg, reason ->
            /*
              Falta de login NÃO é erro de reprodução.

              Antes, qualquer negativa (inclusive "sem sessão") caía no ramo
              `message != null` e desenhava a tela "Entre na sua conta para
              assistir" com um botão "Voltar" — um beco sem saída. Agora, se o
              motivo for de autenticação, a tela manda direto ao login; a
              mensagem só aparece para negativas reais (sem fonte, plano etc.).
            */
            if (reason == "unauthenticated" || reason == "no_subscription" ||
                reason == "trial_expired" || reason == "trial_used" ||
                reason == "trial_unknown" || reason == "account_disabled"
            ) {
                loading = false
                onLoginRequired()
                return@authorize
            }
            url = u
            mode = m
            message = msg
            loading = false
        }
    }

    if (!st.loggedIn) {
        // Nada de player: a tela fica preta por um instante até a navegação
        // trocar para o login.
        Box(Modifier.fillMaxSize().background(Color.Black))
        return
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onKeyEvent { ev ->
                if (ev.type == KeyEventType.KeyDown && ev.key == Key.Back) {
                    onBack()
                    true
                } else false
            },
    ) {
        when {
            loading -> Text(
                "Carregando…",
                color = MfColors.TextMuted,
                modifier = Modifier.align(Alignment.Center),
            )

            message != null -> Column(
                Modifier
                    .align(Alignment.Center)
                    .padding(40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(message!!, color = MfColors.TextSoft, fontSize = 18.sp, lineHeight = 26.sp)
                Spacer(Modifier.height(20.dp))
                Text("Voltar", color = MfColors.Red, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }

            url != null && mode == "direct" -> TvDirectPlayer(url!!, title, season, episode, vm)

            url != null -> TvEmbedPlayer(url!!, onBack)
        }
    }
}

// ────────────────────────────── modo direto (Media3) ──────────────────────────────

@Composable
private fun TvDirectPlayer(
    url: String,
    title: Title,
    season: Int?,
    episode: Int?,
    vm: TvViewModel,
) {
    val context = LocalContext.current
    val focusRequester = remember { FocusRequester() }

    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
            // Começa tocando. Se o aparelho recusar, a retentativa abaixo resolve.
            playWhenReady = true
        }
    }

    // Estado REAL do ExoPlayer — é o que a barra mostra e o que o toggle lê.
    val playingState = remember { mutableStateOf(true) }
    val positionState = remember { mutableStateOf(0.0) }
    val durationState = remember { mutableStateOf(0.0) }

    /** O usuário pausou de propósito: a retentativa de autoplay não deve brigar. */
    var userPaused by remember { mutableStateOf(false) }

    val seek = remember {
        SeekController(
            positionProvider = { positionState.value },
            durationProvider = { durationState.value },
            onSeek = { target ->
                player.seekTo((target * 1000).toLong().coerceAtLeast(0L))
            },
        )
    }
    val toggle = remember { PlayPauseController() }
    // Visibilidade da barra: aparece ao interagir, some após 5 s sem tecla.
    val ui = remember { UiVisibility() }
    // Segurar OK alterna a TELA CHEIA (só o vídeo, sem barra e sem UI).
    val hold = remember { HoldDetector(HOLD_TO_ACTIVATE_MS) }
    var isFullscreen by remember { mutableStateOf(false) }

    DisposableEffect(Unit) { onDispose { player.release() } }

    // Foco: sem isto o Compose não recebe as teclas do controle.
    LaunchedEffect(Unit) {
        runCatching { focusRequester.requestFocus() }
    }

    // Estado real → barra (4× por segundo).
    LaunchedEffect(Unit) {
        while (true) {
            playingState.value = player.isPlaying
            positionState.value = (player.currentPosition / 1000.0).coerceAtLeast(0.0)
            durationState.value = (player.duration / 1000.0).coerceAtLeast(0.0)
            toggle.onState(player.isPlaying)
            delay(250)
        }
    }

    // Autoplay: se o aparelho montou pausado, tenta tocar de novo — mas nunca
    // contra a vontade do usuário (userPaused).
    LaunchedEffect(Unit) {
        repeat(6) {
            delay(700)
            if (!userPaused && !player.isPlaying && player.playbackState != Player.STATE_ENDED) {
                player.play()
            }
        }
    }

    // Relógio do controle: acelera o avanço enquanto a tecla está pressionada e
    // solta a tecla quando o aparelho não manda ACTION_UP.
    LaunchedEffect(Unit) {
        while (true) {
            val now = SystemClock.uptimeMillis()
            seek.tick(now)
            ui.tick(now)
            // Segurar OK alterna a TELA CHEIA: só o vídeo, sem barra.
            if (hold.tick(now) == HoldDetector.PressResult.Hold) {
                ui.poke(now)
                isFullscreen = !isFullscreen
                val act = (context as? android.app.Activity)
                if (act != null) {
                    if (isFullscreen) hideSystemBars(act) else showSystemBars(act)
                }
            }
            // OK sem efeito → reenvia play/pause EXPLÍCITO (um toque basta).
            toggle.retry(now)?.let { want ->
                if (want) player.play() else player.pause()
            }
            delay(50)
        }
    }

    // Salva o progresso a cada 10 s (é o que alimenta "continuar assistindo").
    LaunchedEffect(Unit) {
        while (true) {
            delay(10_000)
            val pos = player.currentPosition / 1000.0
            val dur = player.duration / 1000.0
            if (pos > 0 && dur > 0) {
                vm.saveProgress(
                    title,
                    pos,
                    dur,
                    if (season != null && episode != null) "$season/$episode" else null,
                )
            }
        }
    }

    fun doToggle(repeatCount: Int) {
        // Auto-repeat do controle: só o PRIMEIRO evento (repeatCount 0) conta.
        // Antes, o auto-repeat gerava dois toggles no mesmo toque e o vídeo
        // voltava ao estado anterior — era isso que exigia apertar OK várias
        // vezes para conseguir pausar.
        if (repeatCount > 0) return
        if (!toggle.onKey(SystemClock.uptimeMillis())) return
        if (player.isPlaying) {
            userPaused = true
            player.pause()
        } else {
            userPaused = false
            player.play()
        }
    }

    fun doSeekDown(dir: Int, repeatCount: Int) {
        seek.onKeyDown(dir, repeatCount, SystemClock.uptimeMillis())
    }

    fun doSeekUp() {
        seek.onKeyUp(SystemClock.uptimeMillis())
    }

    Box(
        Modifier
            .fillMaxSize()
            .focusRequester(focusRequester)
            .focusable()
            .onKeyEvent { ev ->
                val native = ev.nativeKeyEvent
                ui.poke(SystemClock.uptimeMillis())
                when (ev.type) {
                    KeyEventType.KeyDown -> when (ev.key) {
                        Key.DirectionCenter, Key.Enter, Key.NumPadEnter, Key.Spacebar,
                        Key.MediaPlayPause, Key.MediaPlay, Key.MediaPause,
                        -> {
                            // SEMPRE começa a contar o "segurar 1,2 s". É o que
                            // permite alternar a tela cheia segurando OK. O
                            // auto-repeat do controle não reinicia a contagem.
                            if (native.repeatCount == 0) {
                                hold.onDown(SystemClock.uptimeMillis())
                            }
                            true
                        }
                        Key.DirectionLeft, Key.MediaRewind -> {
                            doSeekDown(-1, native.repeatCount)
                            true
                        }
                        Key.DirectionRight, Key.MediaFastForward -> {
                            doSeekDown(1, native.repeatCount)
                            true
                        }
                        // ↑ ↓ não fazem nada: o player é só o vídeo e a barra.
                        // São consumidas para o foco não escapar do player.
                        Key.DirectionUp, Key.DirectionDown -> true
                        else -> false
                    }
                    KeyEventType.KeyUp -> when (ev.key) {
                        Key.DirectionCenter, Key.Enter, Key.NumPadEnter, Key.Spacebar,
                        Key.MediaPlayPause, Key.MediaPlay, Key.MediaPause,
                        -> {
                            // Toque curto (sem segurar 1,2 s): play/pause.
                            if (hold.onUp() == HoldDetector.PressResult.Short) {
                                doToggle(0)
                            }
                            true
                        }
                        Key.DirectionLeft, Key.DirectionRight,
                        Key.MediaRewind, Key.MediaFastForward,
                        -> {
                            doSeekUp()
                            true
                        }
                        Key.Back -> {
                            // Em tela cheia, Voltar sai da tela cheia primeiro.
                            if (isFullscreen) {
                                isFullscreen = false
                                (context as? android.app.Activity)?.let { showSystemBars(it) }
                                true
                            } else {
                                false
                            }
                        }
                        else -> false
                    }
                    else -> false
                }
            },
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    this.player = player
                    useController = false
                    isFocusable = false
                    isFocusableInTouchMode = false
                    descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        // A ÚNICA coisa desenhada sobre o vídeo: a barra de progresso.
        // Em tela cheia ela some: fica só o vídeo.
        if (!isFullscreen) {
            TvProgressBar(
                position = positionState.value,
                duration = durationState.value,
                visible = ui.visible,
            )
        }

        /*
          CARD DE PAUSA — o mesmo comportamento do site.

          Aparece quando o vídeo está pausado, com capa, título e descrição.
          Some ao despausar.

          Aqui o estado é CONFIÁVEL: o ExoPlayer é nosso, então `isPlaying` diz
          a verdade (diferente do modo embed do site, onde o `<video>` é de
          outra origem). Por isso o card funciona na TV mesmo quando o site não
          consegue mostrá-lo.

          `userPaused` é exigido junto: a retentativa de autoplay pausa o player
          por alguns instantes ao montar, e sem essa condição o card piscaria na
          abertura, antes do primeiro frame.
        */
        if (userPaused && !playingState.value) {
            TvPauseCard(
                title = title,
                season = season,
                episode = episode,
            )
        }
    }
}

/**
 * Card de pausa da TV.
 *
 * Desenhado sobre o vídeo, centralizado. Não recebe foco: o D-pad continua
 * indo para o Box do player, então OK despausa normalmente — o card é
 * informativo, nunca um obstáculo entre o controle e o vídeo.
 */
@Composable
private fun TvPauseCard(
    title: Title?,
    season: Int?,
    episode: Int?,
) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier = Modifier
                .widthIn(max = 720.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(Color(0xD10A0A0E))
                .border(1.dp, Color(0x24FFFFFF), RoundedCornerShape(20.dp))
                .padding(24.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            val poster = title?.posterUrl
            if (!poster.isNullOrBlank()) {
                AsyncImage(
                    model = poster,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .width(120.dp)
                        .aspectRatio(2f / 3f)
                        .clip(RoundedCornerShape(12.dp)),
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = if (season != null && episode != null) {
                        "TEMPORADA $season · EPISÓDIO $episode"
                    } else {
                        "PAUSADO"
                    },
                    color = Color(0xFFDF0A15),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.2.sp,
                )
                Text(
                    text = title?.title ?: "",
                    color = Color.White,
                    fontSize = 26.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                val desc = title?.description
                if (!desc.isNullOrBlank()) {
                    Text(
                        text = desc,
                        color = Color(0xB8FFFFFF),
                        fontSize = 15.sp,
                        lineHeight = 21.sp,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    text = "Pressione OK para continuar",
                    color = Color(0x73FFFFFF),
                    fontSize = 13.sp,
                )
            }
        }
    }
}

// ────────────────────────────── modo embed (WebView) ──────────────────────────────

/**
 * Origem do site oficial — o provedor só entrega o player com este Referer.
 *
 * Verificado em 2026-11-18 com curl: sem Referer, myembed.biz devolve 94.951
 * bytes do site de cloaking "Investidor.blog"; com Referer do MovieFlix,
 * devolve 3.746 bytes do player real.
 */
private const val SITE_ORIGIN = "https://movieflix.velixir.run/"

/**
 * Quanto tempo o OK precisa ficar pressionado para alternar a TELA CHEIA.
 *
 * 1,2 s é curto o bastante para o gesto parecer natural, e longo o bastante
 * para não disparar num toque normal (que dura ~100 ms) — assim o OK continua
 * sendo, de um toque só, pausar/despausar.
 */
private const val HOLD_TO_ACTIVATE_MS = 1_200L

/**
 * Ponte injetada em TODOS os frames do WebView.
 *
 * `addDocumentStartJavaScript` roda antes de qualquer script da página e
 * alcança frames de outra origem — é o que permite controlar o `<video>` do
 * provedor, coisa que a página web do MovieFlix não consegue fazer.
 *
 * O script:
 *   1. procura o `<video>` (o provedor pode criá-lo depois, então tenta de novo
 *      a cada 250 ms por até 2,5 min);
 *   2. escuta os eventos reais do elemento e reporta o estado ao app;
 *   3. tenta tocar sozinho ao abrir (o provedor monta pausado);
 *   4. esconde a UI do provedor e APAGA qualquer anel de foco;
 *   5. expõe `window.__mfCmd(cmd, arg)` para o app mandar
 *      toggle / play / pause / seekTo.
 *
 * `seekTo` recebe a posição ABSOLUTA em segundos — é o que faz o vídeo parar
 * exatamente no ponto mostrado na barra, sem deriva.
 */
private val BRIDGE_JS: String = """
(function () {
  if (window.__mf) return;
  var S = { v: null, playing: false, t: 0, d: 0, ready: false, tried: 0, autoTried: 0,
            clickX: null, clickY: null, mouseMode: false, fs: false,
            isTop: (window.parent === window) };
  window.__mf = S;

  /**
   * Esconde a UI do provedor e mata o anel de foco.
   *
   * O proprietário pediu um player limpo: só a barra de progresso. Nada de
   * configurações, volume, legendas, tela cheia, seleção de servidor, ícones,
   * títulos ou painéis. O player do provedor (playerflix.ink) desenha a barra
   * dele dentro do iframe: `#ui`, `.scrim-top`, `#reportWrap`, `#toast`, o selo
   * "embedmovies.org" e a view de episódios.
   *
   * O <video> em si NUNCA é escondido: é ele que toca o filme.
   *
   * NUNCA deixa uma exceção escapar: cosmético (esconder a UI) não pode
   * derrubar o controle.
   */
  function hideProviderUi() {
    try {
      if (!document || typeof document.getElementById !== 'function') return;
      /*
        A UI do provedor fica escondida SEMPRE \u2014 inclusive com o mouse virtual
        ligado. Antes, o mouse ligado devolvia a barra do provedor para "ter o
        que clicar": era isso que enchia a tela de botoes duplicados (play,
        volume, tela cheia do provedor) por cima da NOSSA barra \u2014 exatamente o
        defeito das fotos do proprietario. O mouse virtual continua funcionando
        (move o cursor e clica), mas nao ha mais UI do provedor para aparecer: o
        unico controle e o nosso.
      */
      var legacy = document.getElementById('__mf_clean');
      if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);
      // Garantia continua: se o provedor recriar o <video> com controls=true,
      // os controles nativos voltam. Reaplicar a cada volta do laco.
      try {
        var vs = document.querySelectorAll('video');
        for (var i = 0; i < vs.length; i++) {
          if (vs[i].controls) { vs[i].controls = false; vs[i].removeAttribute('controls'); }
        }
      } catch (e) {}
      if (!document.getElementById('__mf_clean')) {
        var st = document.createElement('style');
        st.id = '__mf_clean';
        // O player do provedor e o ArtPlayer (v2.watchplay.shop). A lista
        // antiga mirava #ui/.scrim-top/.controls, que sao do shell do
        // playerflix.ink e NAO existem no frame que desenha os botoes — por
        // isso os controles apareciam duplicados. Estes sao os seletores
        // reais, lidos do DOM em producao.
        st.textContent = [
          '.art-controls', '.art-bottom', '.art-mask', '.art-loading',
          '.art-poster', '.art-notice', '.art-info', '.art-settings',
          '.art-contextmenus', '.art-layers', '.art-subtitle', '.art-danmuku',
          '.art-progress-tip', '.art-control-thumbnails', '.art-auto-playback',
          '.art-state', '.art-icon', '#wp-initial-play',
          '.art-control-volume', '.art-control-fullscreen',
          '.art-control-playAndPause', '.art-control-time',
          '.art-controls-left', '.art-controls-center', '.art-controls-right',
          '#ui', '.ui', '#reportWrap', '.report-wrap', '#toast', '.toast',
          '.scrim-top', '#episodesView', '#episodes', '.ep-season-row',
          '.ep-season-select', '.top-actions', '.source-trigger', '.icon-btn',
          '.next-btn', '.prev-btn', '.panel', '.panel-body-wrap', '.panel-list',
          '.title-wrap', '.crumb', '.brand-container', '.pro-loader',
          '#playerLoader', '.loading-wrapper', '.controls', '.control-bar',
          '.player-controls', '.settings', '.settings-panel', '.volume',
          '.volume-control', '.subtitle', '.subtitles', '.quality', '.fullscreen',
        ].join(',') + '{display:none !important;visibility:hidden !important;opacity:0 !important;pointer-events:none !important;}' +
          // O <video> NUNCA e escondido: e ele que toca o filme.
          'video{display:block !important;visibility:visible !important;opacity:1 !important;}' +
          // Nenhum anel/borda de foco, em nenhum elemento, em nenhum estado.
          '*:focus{outline:none !important;outline-offset:0 !important;box-shadow:none !important;}' +
          '*:focus-visible{outline:none !important;box-shadow:none !important;}' +
          '*::-moz-focus-inner{border:0 !important;}' +
          'video::-webkit-media-controls{display:none !important;}' +
          'video::-webkit-media-controls-enclosure{display:none !important;}' +
          /*
            TELA CHEIA PELO NOSSO LADO.

            O botao de tela cheia do provedor pede `requestFullscreen()`, que o
            WebView do Android recusa em silencio dentro de iframe de outra
            origem (so o Chromium aceita, e so com a cadeia inteira de iframes
            permitindo). Por isso o clique nunca entrava em tela cheia.

            Aqui nao dependemos dele: `window.__mfCmd('fullscreen', 1)` poe o
            `<video>` cobrindo a janela inteira, em cima de qualquer UI que o
            provedor ainda desenhe. Nada de controles: so o video.
          */
          (S.fs
            ? 'video{position:fixed !important;top:0 !important;left:0 !important;' +
              'width:100vw !important;height:100vh !important;max-width:none !important;' +
              'max-height:none !important;z-index:2147483646 !important;' +
              'object-fit:contain !important;background:#000 !important;}'
            : '');
        (document.head || document.documentElement).appendChild(st);
      }

      // LIMPEZA GENERICA.
      // A lista de classes por provedor quebrava a cada troca de provedor
      // (ArtPlayer -> embedplay.one): os botoes voltavam a aparecer porque os
      // nomes de classe eram outros. Aqui nao dependemos de nome nenhum:
      // escondemos todo elemento que nao seja o <video> nem um ancestral dele.
      // Sobra o video, e so ele.
      var v = pick();
      if (!v) return;
      var keep = [];
      var n = v;
      while (n && n !== document.body) { keep.push(n); n = n.parentNode; }
      var kids = document.body.children;
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i];
        if (!el || el.tagName === 'VIDEO') continue;
        if (keep.indexOf(el) !== -1) continue;
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
        if (!el.classList.contains('__mf_hidden')) el.classList.add('__mf_hidden');
      }
      // Dentro da cadeia que contem o video, esconde os irmaos que nao levam
      // ao video (barras, paineis, titulos, botoes) - o video fica sozinho.
      for (var k = 0; k < keep.length; k++) {
        var node = keep[k];
        var sibs = node.parentNode ? node.parentNode.children : null;
        if (!sibs) continue;
        for (var j = 0; j < sibs.length; j++) {
          var s = sibs[j];
          if (!s || s === node) continue;
          if (s.tagName === 'SCRIPT' || s.tagName === 'STYLE' || s.tagName === 'LINK') continue;
          if (s.tagName === 'VIDEO') continue;
          if (keep.indexOf(s) !== -1) continue;
          if (!s.classList.contains('__mf_hidden')) s.classList.add('__mf_hidden');
        }
      }

      // NAO chamar blur() aqui. O laco de 500 ms chamava blur no
      // activeElement a cada volta; o provedor devolvia o foco e os dois
      // brigavam - era isso que fazia o OK precisar de varias pressoes e o
      // anel amarelo piscar. O foco agora fica no Box do Compose (o WebView
      // nao e focavel), entao nao ha o que roubar.
    } catch (e) {}
  }

  function pick() {
    var vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      if (v && (v.currentSrc || v.src || v.readyState > 0)) return v;
    }
    return vs.length ? vs[0] : null;
  }

  /**
   * Reporta o estado ao app.
   *
   * O <video> vive no frame mais fundo (v2.watchplay.shop), que NAO tem a
   * interface MfPlayer — ela so existe no frame principal. Por isso o estado
   * sobe por postMessage ate o topo, que repassa ao app.
   */
  function post(o) {
    try {
      if (S.isTop) {
        if (window.MfPlayer && window.MfPlayer.post) window.MfPlayer.post(JSON.stringify(o));
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage({ __mfState: o }, '*');
      }
    } catch (e) {}
  }

  /**
   * Manda o comando para os iframes filhos.
   *
   * `evaluateJavascript` do WebView so alcanca o frame principal (myembed.biz),
   * que nao tem <video>. Sem este repasse o comando morria ali e o OK "nao
   * funcionava". Cada frame sem video repassa para os seus filhos, entao o
   * comando desce myembed -> playerflix -> watchplay, onde o video esta.
   */
  function forward(cmd, arg) {
    var sent = false;
    try {
      var fs = document.querySelectorAll('iframe');
      for (var i = 0; i < fs.length; i++) {
        try {
          fs[i].contentWindow.postMessage({ __mfCmd: cmd, __mfArg: arg }, '*');
          sent = true;
        } catch (x) {}
      }
    } catch (e) {}
    return sent;
  }

  /** Executa o comando no <video> DESTE frame. */
  function exec(cmd, arg) {
    if (!attach()) return false;
    var v = S.v;
    try {
      if (cmd === 'toggle') {
        if (v.paused) { S.autoTried = 99; v.play(); } else { S.autoTried = 99; v.pause(); }
      }
      else if (cmd === 'play') { S.autoTried = 99; v.play(); }
      else if (cmd === 'pause') { S.autoTried = 99; v.pause(); }
      else if (cmd === 'seekTo') {
        var d = isFinite(v.duration) ? v.duration : 0;
        var t = Number(arg);
        if (!isFinite(t)) t = 0;
        v.currentTime = Math.max(0, d > 0 ? Math.min(d, t) : t);
      }
      else if (cmd === 'clickAt') {
        // Mouse virtual: guarda a fração X e espera a Y para clicar no ponto.
        S.clickX = Number(arg);
        if (S.clickY != null) doClick();
      }
      else if (cmd === 'clickAtY') {
        S.clickY = Number(arg);
        if (S.clickX != null) doClick();
      }
      /*
        TELA CHEIA PELO NOSSO LADO \u2014 nao depende do provedor.

        `S.fs` liga/desliga o CSS que faz o `<video>` cobrir a janela inteira,
        em cima de qualquer UI do provedor. Reconstruimos o estilo na hora para
        a troca valer no mesmo toque, sem esperar o laco de 1 s.

        E o unico caminho de tela cheia que funciona de verdade aqui: o
        `requestFullscreen()` do botao do provedor e recusado em silencio pelo
        WebView do Android dentro de iframe de outra origem.
      */
      else if (cmd === 'fullscreen') {
        S.fs = !!Number(arg);
        var prev = document.getElementById('__mf_clean');
        if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
        hideProviderUi();
        sync();
        post(snapshot());
        return true;
      }
      sync();
      post(snapshot());
      return true;
    } catch (e) { return false; }
  }

  /**
   * Clique sintético na posição do cursor virtual.
   *
   * O app manda a posição em FRAÇÃO da tela (0..1). Aqui ela vira coordenada
   * de viewport e o evento é despachado no elemento que está naquele ponto —
   * é assim que o mouse do controle alcança os controles nativos do player
   * (play/pause, barra, volume, tela cheia) sem duplicar botões.
   */
  function doClick() {
    var fx = S.clickX, fy = S.clickY;
    S.clickX = null; S.clickY = null;
    if (!isFinite(fx) || !isFinite(fy)) return;
    var x = Math.round(fx * (window.innerWidth || 1));
    var y = Math.round(fy * (window.innerHeight || 1));
    var el = document.elementFromPoint(x, y) || document.body;
    if (!el) return;
    var opts = { bubbles: true, cancelable: true, clientX: x, clientY: y,
                 view: window, button: 0, buttons: 1 };
    try { el.dispatchEvent(new MouseEvent('mousemove', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch (e) {}
    // Se o alvo for o próprio <video>, o clique também alterna play/pause.
    try { if (el === S.v) { if (S.v.paused) S.v.play(); else S.v.pause(); } } catch (e) {}
  }

  // Recebe estado dos filhos (repassa para cima) e comandos do pai (executa
  // ou continua descendo). Chamar __mfCmd aqui e o que faz o comando cascatear.
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d) return;
    if (d.__mfState) {
      if (S.isTop) {
        try { if (window.MfPlayer && window.MfPlayer.post) window.MfPlayer.post(JSON.stringify(d.__mfState)); } catch (x) {}
      } else if (window.parent && window.parent !== window) {
        try { window.parent.postMessage({ __mfState: d.__mfState }, '*'); } catch (x) {}
      }
      return;
    }
    if (d.__mfCmd) window.__mfCmd(d.__mfCmd, d.__mfArg);
  });

  /** Estado completo — o app lê estes campos, não só o `type`. */
  function snapshot() {
    return { type: 'state', playing: S.playing, t: S.t, d: S.d, ready: S.ready };
  }

  function sync() {
    var v = S.v;
    if (!v) return;
    S.playing = !v.paused && !v.ended;
    S.t = v.currentTime || 0;
    S.d = (isFinite(v.duration) ? v.duration : 0);
    S.ready = true;
  }

  /**
   * O provedor monta o vídeo pausado. Tenta tocar algumas vezes: o navegador
   * pode recusar antes de haver dados, e aí tentamos de novo em canplay.
   * Nunca insiste depois que o usuário pausou (o app manda 'pause' e o
   * autoTried é encerrado).
   */
  function autoPlay() {
    var v = S.v;
    if (!v || S.autoTried > 12) return;
    S.autoTried++;
    if (!v.paused) return;
    try {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function attach() {
    var v = pick();
    if (!v) return false;
    if (v !== S.v) {
      S.v = v;
      // Controles nativos do <video> desligados SEMPRE. O provedor costuma
      // vir com controls=false, mas a rota de teste (MP4 direto) vem com
      // controls=true — e aí o Chrome desenha play/volume/engrenagem/tela
      // cheia por cima da nossa barra. Aqui a garantia é incondicional.
      try { v.controls = false; v.removeAttribute('controls'); } catch (e) {}
      var evs = ['play','playing','pause','timeupdate','durationchange','loadedmetadata',
                 'volumechange','ended','seeking','seeked','canplay'];
      for (var i = 0; i < evs.length; i++) {
        v.addEventListener(evs[i], function () { sync(); post(snapshot()); }, true);
      }
      v.addEventListener('canplay', function () { autoPlay(); }, true);
      autoPlay();
    }
    sync();
    return true;
  }

  // Esconde a UI do provedor desde o primeiro instante — não espera o <video>.
  // O proprietário quer a tela limpa; a barra é a nossa.
  hideProviderUi();
  // 1 s basta para reaplicar o CSS quando o provedor redesenha a UI. Antes era
  // 500 ms E com blur() a cada volta, o que quebrava o foco.
  setInterval(hideProviderUi, 1000);

  var iv = setInterval(function () {
    S.tried++;
    if (attach() || S.tried > 600) clearInterval(iv);
  }, 250);

  // Tenta já, sem esperar o primeiro tick.
  attach();

  // Heartbeat: mantém a barra viva mesmo se o provedor não emitir eventos.
  setInterval(function () {
    if (!S.v) return;
    sync();
    post(snapshot());
  }, 500);

  window.__mfCmd = function (cmd, arg) {
    // mouseMode vale para TODOS os frames, mesmo os que ainda nao tem video:
    // e o que decide se a UI do provedor fica escondida ou clicavel.
    if (cmd === 'mouseMode') {
      S.mouseMode = !!Number(arg);
      hideProviderUi();
      forward(cmd, arg);
      return true;
    }
    // Este frame tem o video? Executa. Se nao, desce para os filhos.
    if (attach()) return exec(cmd, arg);
    var sent = forward(cmd, arg);
    // Sem video aqui e sem filhos para repassar: avisa o app (erro real, nao
    // controle). Se repassou, o frame de baixo responde.
    if (!sent) post({ type: 'novideo' });
    return sent;
  };

  post({ type: 'ready' });
})();
""".trimIndent()

/** Recebe o estado do `<video>` vindo do JS. */
private class PlayerBridge(private val onMessage: (String) -> Unit) {
    @JavascriptInterface
    fun post(json: String) = onMessage(json)
}

/**
 * Esconde as barras do sistema (status/navegação) — tela cheia imersiva.
 *
 * Sem isto, mesmo com a view do player em cima de tudo, a barra de status do
 * Android continuava desenhada e o vídeo não ocupava a tela inteira.
 */
private fun hideSystemBars(activity: android.app.Activity) {
    runCatching {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            val c = activity.window.insetsController ?: return@runCatching
            c.hide(android.view.WindowInsets.Type.systemBars())
            c.systemBarsBehavior =
                android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            @Suppress("DEPRECATION")
            activity.window.decorView.systemUiVisibility = (
                android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                    or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                )
        }
    }
}

/** Devolve as barras do sistema ao sair da tela cheia. */
private fun showSystemBars(activity: android.app.Activity) {
    runCatching {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            activity.window.insetsController?.show(android.view.WindowInsets.Type.systemBars())
        } else {
            @Suppress("DEPRECATION")
            activity.window.decorView.systemUiVisibility = android.view.View.SYSTEM_UI_FLAG_VISIBLE
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun TvEmbedPlayer(url: String, onBack: () -> Unit) {
    var webView by remember { mutableStateOf<WebView?>(null) }
    var failed by remember { mutableStateOf(false) }
    var pageReady by remember { mutableStateOf(false) }

    // Estado REAL do vídeo, reportado pelo JS.
    val playingState = remember { mutableStateOf(false) }
    val positionState = remember { mutableStateOf(0.0) }
    val durationState = remember { mutableStateOf(0.0) }
    var hasVideo by remember { mutableStateOf(false) }
    /** Só avisa "sem vídeo" depois de dar tempo real ao provedor. */
    var waitedLong by remember { mutableStateOf(false) }
    var hint by remember { mutableStateOf<String?>(null) }
    /** Recarrega a página do provedor (o "Tentar novamente" do aviso). */
    var reloadKey by remember { mutableStateOf(0) }
    /** Última chave de recarga já aplicada ao WebView. */
    var lastReloadKey by remember { mutableStateOf(0) }
    /** API < 30: sem `addDocumentStartJavaScript`, injeta no onPageFinished. */
    var legacyBridge by remember { mutableStateOf(false) }

    /**
     * Tela cheia do player do provedor.
     *
     * `onShowCustomView` entrega a view do player; guardamos aqui para poder
     * removê-la do decorView ao sair. `isFullscreen` esconde a NOSSA barra de
     * progresso: em tela cheia fica só o vídeo, como o proprietário pediu.
     */
    var fullscreenView by remember { mutableStateOf<android.view.View?>(null) }
    var fullscreenCallback by remember {
        mutableStateOf<WebChromeClient.CustomViewCallback?>(null)
    }
    var isFullscreen by remember { mutableStateOf(false) }

    // O Box do Compose é o ÚNICO elemento focável da tela. É ele que recebe o
    // D-pad — o WebView não é focável, então o foco nunca entra no DOM do
    // provedor e o anel amarelo não tem como aparecer.
    val focusRequester = remember { FocusRequester() }

    val seek = remember {
        SeekController(
            positionProvider = { positionState.value },
            durationProvider = { durationState.value },
            onSeek = { target ->
                webView?.evaluateJavascript(
                    "window.__mfCmd && window.__mfCmd('seekTo',$target)",
                    null,
                )
            },
        )
    }
    val toggle = remember { PlayPauseController() }
    // Visibilidade da barra: aparece ao interagir, some após 5 s sem tecla.
    val ui = remember { UiVisibility() }
    // Segurar OK alterna a tela cheia (não existe mais mouse virtual no embed:
    // ele servia para clicar na UI do provedor, que agora fica sempre escondida).
    val hold = remember { HoldDetector(HOLD_TO_ACTIVATE_MS) }

    fun js(cmd: String, arg: Double? = null) {
        val a = arg?.let { ",$it" } ?: ""
        webView?.evaluateJavascript("window.__mfCmd && window.__mfCmd('$cmd'$a)", null)
    }

    fun doToggle(repeatCount: Int) {
        // Um toque = um toggle. O auto-repeat do controle (repeatCount > 0) é
        // ignorado: era ele que disparava dois comandos e deixava o vídeo no
        // mesmo estado, obrigando a apertar OK várias vezes.
        if (repeatCount > 0) return
        if (!toggle.onKey(SystemClock.uptimeMillis())) return
        js("toggle")
    }

    fun doSeekDown(dir: Int, repeatCount: Int) {
        seek.onKeyDown(dir, repeatCount, SystemClock.uptimeMillis())
    }

    fun doSeekUp() {
        seek.onKeyUp(SystemClock.uptimeMillis())
    }

    /**
     * Entra e sai da TELA CHEIA pelo nosso lado.
     *
     * A ponte põe o `<video>` cobrindo a janela inteira (comando `fullscreen`) e
     * nós escondemos a barra de progresso e o cursor, além das barras do
     * sistema. Ao sair, tudo volta exatamente como estava.
     *
     * É o único caminho de tela cheia que funciona no WebView do Android: o
     * `requestFullscreen()` do botão do provedor é recusado em silêncio dentro de
     * iframe de outra origem.
     */
    fun setFullscreen(on: Boolean) {
        isFullscreen = on
        js("fullscreen", if (on) 1.0 else 0.0)
        val act = (webView?.context as? android.app.Activity)
        if (act != null) {
            if (on) hideSystemBars(act) else showSystemBars(act)
        }
    }

    // Foco inicial e re-foco depois que a página carrega (o WebView pode pedir
    // foco ao terminar de carregar; devolvemos para o Box).
    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }
    LaunchedEffect(pageReady) { runCatching { focusRequester.requestFocus() } }

    // Relógio do controle: aceleração progressiva + watchdog de soltura +
    // reenvio do OK se o player não obedeceu.
    LaunchedEffect(Unit) {
        while (true) {
            val now = SystemClock.uptimeMillis()
            seek.tick(now)
            ui.tick(now)
            // Segurar OK alterna TELA CHEIA.
            //
            // O botão de tela cheia do provedor não funciona no WebView do
            // Android (o `requestFullscreen()` dentro de iframe de outra origem
            // é recusado em silêncio). Então a tela cheia é NOSSA: a ponte põe o
            // `<video>` cobrindo a janela e esconde a nossa barra. Um gesto só,
            // reversível pelo mesmo gesto ou pelo Voltar.
            if (hold.tick(now) == HoldDetector.PressResult.Hold) {
                ui.poke(now)
                setFullscreen(!isFullscreen)
            }
            // O player do provedor às vezes ignora o primeiro toggle (iframe
            // ainda montando). Se o estado não mudou, manda play/pause
            // EXPLÍCITO — nunca outro toggle, para não desfazer o que deu certo.
            toggle.retry(now)?.let { want -> js(if (want) "play" else "pause") }
            delay(50)
        }
    }

    // Aviso honesto só depois de 12 s sem <video> (não é controle, é erro).
    LaunchedEffect(pageReady) {
        if (pageReady) {
            delay(12_000)
            waitedLong = true
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            seek.cancel()
            webView?.let {
                it.loadUrl("about:blank")
                it.destroy()
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .focusRequester(focusRequester)
            .focusable()
            .onKeyEvent { ev ->
                val native = ev.nativeKeyEvent
                ui.poke(SystemClock.uptimeMillis())
                when (ev.type) {
                    KeyEventType.KeyDown -> when (ev.key) {
                        Key.DirectionCenter, Key.Enter, Key.NumPadEnter, Key.Spacebar,
                        Key.MediaPlayPause, Key.MediaPlay, Key.MediaPause,
                        -> {
                            // SEMPRE começa a contar o "segurar 1,2 s". É o que
                            // permite alternar a tela cheia segurando OK. O
                            // auto-repeat do controle não reinicia a contagem.
                            if (native.repeatCount == 0) {
                                hold.onDown(SystemClock.uptimeMillis())
                            }
                            true
                        }
                        Key.DirectionLeft, Key.MediaRewind -> {
                            doSeekDown(-1, native.repeatCount)
                            true
                        }
                        Key.DirectionRight, Key.MediaFastForward -> {
                            doSeekDown(1, native.repeatCount)
                            true
                        }
                        // ↑ ↓ não fazem nada: o player é só o vídeo e a barra.
                        // São consumidas para o foco não escapar do player.
                        Key.DirectionUp, Key.DirectionDown -> true
                        Key.Back -> {
                            // Em tela cheia, Voltar sai da tela cheia primeiro
                            // (é o que o usuário espera); só depois sai do player.
                            if (isFullscreen) {
                                setFullscreen(false)
                            } else {
                                onBack()
                            }
                            true
                        }
                        else -> false
                    }
                    KeyEventType.KeyUp -> when (ev.key) {
                        Key.DirectionCenter, Key.Enter, Key.NumPadEnter, Key.Spacebar,
                        Key.MediaPlayPause, Key.MediaPlay, Key.MediaPause,
                        -> {
                            // Toque curto (sem segurar 2 s): com o mouse ligado
                            // é clique na posição do cursor; desligado é
                            // play/pause normal.
                            if (hold.onUp() == HoldDetector.PressResult.Short) {
                                doToggle(0)
                            }
                            true
                        }
                        Key.DirectionLeft, Key.DirectionRight,
                        Key.MediaRewind, Key.MediaFastForward,
                        -> {
                            doSeekUp()
                            true
                        }
                        else -> false
                    }
                    else -> false
                }
            },
    ) {
        AndroidView(
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    setBackgroundColor(android.graphics.Color.BLACK)

                    // ── A CORREÇÃO DA BORDA AMARELA ──────────────────────────
                    // O WebView NÃO é focável e bloqueia o foco dos descendentes.
                    // Assim o D-pad nunca entra no DOM do provedor: não há
                    // navegação de foco, não há anel amarelo, e o OK chega
                    // sempre ao nosso handler (no Box do Compose).
                    isFocusable = false
                    isFocusableInTouchMode = false
                    descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
                    isClickable = false
                    isLongClickable = false

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        mediaPlaybackRequiresUserGesture = false
                        javaScriptCanOpenWindowsAutomatically = false
                        setSupportMultipleWindows(false)
                        allowFileAccess = false
                        allowContentAccess = false
                        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        /*
                          User-Agent.

                          Antes: `"$userAgentString MovieFlixTV/1.0"`. O sufixo
                          próprio é o que faz alguns provedores recusarem o
                          player: eles liberam o embed para navegadores
                          conhecidos e tratam UA desconhecido como cliente não
                          autorizado — exatamente o sintoma relatado na TV LG
                          ("o provedor não liberou o vídeo para este aparelho").

                          Agora o WebView se apresenta como um Chrome comum de
                          desktop. É o UA para o qual o provedor entrega o
                          player, e é o mesmo que o site usa quando aberto num
                          navegador de computador. Nada de identificação
                          própria: o app não precisa se anunciar para tocar o
                          vídeo.
                        */
                        userAgentString =
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                                "Chrome/122.0.0.0 Safari/537.36"
                    }

                    // A ponte precisa existir ANTES do loadUrl.
                    addJavascriptInterface(
                        PlayerBridge { msg ->
                            runCatching {
                                val o = JSONObject(msg)
                                when (o.optString("type")) {
                                    "state" -> {
                                        val p = o.optBoolean("playing", false)
                                        playingState.value = p
                                        positionState.value = o.optDouble("t", 0.0)
                                        durationState.value = o.optDouble("d", 0.0)
                                        hasVideo = o.optBoolean("ready", false)
                                        toggle.onState(p)
                                    }
                                    "novideo" -> hasVideo = false
                                }
                            }
                        },
                        "MfPlayer",
                    )

                    // Script em todos os frames, inclusive os de outra origem.
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                        androidx.webkit.WebViewCompat.addDocumentStartJavaScript(
                            this,
                            BRIDGE_JS,
                            setOf("*"),
                        )
                    } else {
                        legacyBridge = true
                    }

                    webChromeClient = object : WebChromeClient() {
                        override fun onCreateWindow(
                            view: WebView?,
                            isDialog: Boolean,
                            isUserGesture: Boolean,
                            resultMsg: android.os.Message?,
                        ): Boolean = false

                        /**
                         * TELA CHEIA DE VERDADE.
                         *
                         * Causa raiz do bug relatado ("clico em tela cheia,
                         * aparece uma borda azul, mas os botoes nao somem"):
                         * o player do provedor pede tela cheia pelo caminho
                         * padrao do navegador — `element.requestFullscreen()`
                         * ou `video.webkitEnterFullscreen()`. No WebView do
                         * Android esse pedido NAO e atendido sozinho: ele chega
                         * aqui, em `onShowCustomView`. Sem esta implementacao o
                         * pedido era simplesmente descartado — nada mudava na
                         * tela, e o unico efeito visivel era o anel de foco do
                         * D-pad em volta do botao. Nao era "tela cheia com
                         * borda": era tela cheia que nunca acontecia.
                         *
                         * Aqui o pedido e atendido: a view do player vai para
                         * uma camada em cima de TUDO (decorView), as barras do
                         * sistema somem e a nossa barra de progresso tambem —
                         * fica so o video. Ao sair, tudo volta como estava.
                         */
                        override fun onShowCustomView(
                            view: android.view.View?,
                            callback: CustomViewCallback?,
                        ) {
                            if (view == null) return
                            val activity = (context as? android.app.Activity) ?: return
                            val decor = activity.window.decorView as android.view.ViewGroup
                            if (fullscreenView != null) {
                                callback?.onCustomViewHidden()
                                return
                            }
                            fullscreenView = view
                            fullscreenCallback = callback
                            decor.addView(
                                view,
                                android.view.ViewGroup.LayoutParams(
                                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                                ),
                            )
                            isFullscreen = true
                            hideSystemBars(activity)
                        }

                        override fun onHideCustomView() {
                            val activity = (context as? android.app.Activity) ?: return
                            val decor = activity.window.decorView as android.view.ViewGroup
                            fullscreenView?.let { decor.removeView(it) }
                            fullscreenView = null
                            fullscreenCallback?.onCustomViewHidden()
                            fullscreenCallback = null
                            isFullscreen = false
                            showSystemBars(activity)
                        }
                    }

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?,
                        ): Boolean {
                            val host = request?.url?.host ?: return true
                            return !isProviderHost(host)
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            pageReady = true
                            // API < 30 não tem injeção em todos os frames; o
                            // script entra aqui, no frame principal.
                            if (legacyBridge) {
                                view?.evaluateJavascript(BRIDGE_JS, null)
                            }
                        }

                        override fun onReceivedError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            error: android.webkit.WebResourceError?,
                        ) {
                            super.onReceivedError(view, request, error)
                            if (request?.isForMainFrame == true) failed = true
                        }
                    }

                    // O Referer é o que faz o provedor entregar o player.
                    loadUrl(url, mapOf("Referer" to SITE_ORIGIN))

                    /*
                      NÃO registramos `setOnKeyListener` aqui.

                      Havia um segundo tratamento de teclas neste WebView, além
                      do Box do Compose — e os DOIS disparavam o comando no mesmo
                      toque. O resultado era o defeito que o proprietário
                      descreveu: um OK mandava dois toggles (pausa e despausa no
                      mesmo toque) e as setas pediam dois seeks.

                      Como o WebView não é focável (`isFocusable = false` +
                      `FOCUS_BLOCK_DESCENDANTS`), ele nunca recebe o D-pad: o
                      único handler é o do Box. Um toque, um comando.

                      O `Key.Back` também sai daqui: quem trata Voltar (e a saída
                      da tela cheia) é o handler do Box.
                    */

                    webView = this
                }
            },
            /*
              "Tentar novamente" recarrega a página do provedor.

              O `factory` só roda uma vez; sem este `update` o botão mudaria o
              estado do Compose mas o WebView continuaria na página antiga — o
              usuário apertaria e nada aconteceria. Comparamos com a última
              chave aplicada para não recarregar em toda recomposição.
            */
            update = { view ->
                if (reloadKey != lastReloadKey) {
                    lastReloadKey = reloadKey
                    view.loadUrl(url, mapOf("Referer" to SITE_ORIGIN))
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        if (!pageReady && !failed) {
            Text(
                "Abrindo o player…",
                color = MfColors.TextMuted,
                fontSize = 18.sp,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        if (failed) {
            Column(
                Modifier
                    .align(Alignment.Center)
                    .padding(40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "Não foi possível abrir o player agora.",
                    color = MfColors.TextSoft,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "Verifique a conexão e tente novamente em instantes.",
                    color = MfColors.TextMuted,
                    fontSize = 16.sp,
                )
            }
        }

        // Aviso honesto (só erro, não controle): a página abriu mas não há
        // <video> para controlar depois de 12 s.
        //
        // O texto deixou de culpar o provedor: em TV antiga o motivo mais comum
        // é o WebView do aparelho não conseguir decodificar o formato entregue.
        // Dizer a causa provável e oferecer "Tentar novamente" é mais útil do
        // que uma frase que parece definitiva.
        if (pageReady && !hasVideo && !failed && waitedLong) {
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 40.dp, start = 60.dp, end = 60.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "O vídeo não abriu neste aparelho.",
                    color = MfColors.TextSoft,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "O player do provedor não conseguiu iniciar aqui. Em TVs mais antigas " +
                        "isso costuma acontecer quando o navegador do aparelho não suporta o " +
                        "formato do vídeo. Tente novamente ou assista pelo site em outro aparelho.",
                    color = MfColors.TextMuted,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                )
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TvActionButton("Tentar novamente", primary = true) {
                        waitedLong = false
                        pageReady = false
                        hasVideo = false
                        reloadKey++
                    }
                    TvActionButton("Voltar", primary = false) { onBack() }
                }
            }
        }

        // A ÚNICA coisa desenhada sobre o vídeo: a barra de progresso.
        // Em tela cheia ela some: fica só o vídeo, como o proprietário pediu.
        if (!isFullscreen) {
            TvProgressBar(
                position = positionState.value,
                duration = durationState.value,
                visible = ui.visible,
            )
        }
    }
}

// ────────────────────────────── barra ──────────────────────────────

/**
 * A barra de progresso — e SÓ ela.
 *
 * Sem ícone de play/pause, sem botões, sem dica de teclas, sem título, sem
 * painel, sem moldura. É o que o proprietário pediu: "somente o vídeo e uma
 * única barra de progresso inferior".
 *
 * O tempo atual e a duração total aparecem acima da barra, à direita, em texto
 * discreto — é a única informação escrita na tela, e some junto com a barra.
 *
 * Os números vêm do `<video>` real (ou do ExoPlayer, no modo direto) — não de
 * um contador estimado. Quando a duração ainda não é conhecida, a barra fica
 * vazia em vez de inventar uma porcentagem.
 */
@Composable
private fun TvProgressBar(position: Double, duration: Double, visible: Boolean) {
    // Some por completo quando o usuário fica 5 s sem interagir: só o vídeo fica.
    if (!visible) return
    val pct = if (duration > 0) (position / duration).coerceIn(0.0, 1.0) else 0.0

    Box(
        Modifier.fillMaxSize(),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // "tempo atual / duração total" — a única escrita na tela.
            Text(
                text = "${formatClock(position)} / ${formatClock(duration)}",
                color = Color(0xE6FFFFFF),
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .align(Alignment.End)
                    .padding(end = 24.dp, bottom = 8.dp),
            )
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .background(Color(0x33FFFFFF)),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(pct.toFloat())
                        .fillMaxHeight()
                        .background(MfColors.Red, RoundedCornerShape(topEnd = 2.dp, bottomEnd = 2.dp)),
                )
            }
        }
    }
}

/** "1:23:45" ou "12:34" — tempo atual/duração mostrados na barra. */
private fun formatClock(seconds: Double): String {
    if (!seconds.isFinite() || seconds <= 0) return "0:00"
    val total = seconds.toLong()
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/**
 * Hosts do provedor que podem navegar dentro do WebView.
 *
 * O provedor é o MegaEmbed (`mgeb.space`). Os hosts do player azul continuam
 * listados de propósito: se algum título antigo ainda apontar para lá, o
 * WebView precisa conseguir carregar a página em vez de travar numa tela em
 * branco. Eles não são usados para reproduzir — o servidor só entrega MegaEmbed.
 */
private fun isProviderHost(host: String): Boolean =
    host.contains("mgeb") ||
        host.contains("megaembed") ||
        host.contains("myembed") ||
        host.contains("playerflix") ||
        host.contains("embedplay") ||
        host.contains("embedmovies") ||
        host.contains("cloudflare") ||
        host.contains("challenges.")