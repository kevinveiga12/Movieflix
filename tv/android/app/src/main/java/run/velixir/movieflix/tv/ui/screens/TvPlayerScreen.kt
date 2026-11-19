package run.velixir.movieflix.tv.ui.screens

import android.annotation.SuppressLint
import android.os.SystemClock
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay
import org.json.JSONObject
import run.velixir.movieflix.tv.TvViewModel
import run.velixir.movieflix.tv.data.Title
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
 *   e) Voltar sai do player;
 *   f) o foco NUNCA sai do player nem revela elementos escondidos.
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
 *   3. a ponte JS apaga qualquer `outline`/anel de foco e faz `blur()` no
 *      elemento ativo da página do provedor, para que nem um `focus()` vindo
 *      do próprio provedor desenhe borda;
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
) {
    var url by remember { mutableStateOf<String?>(null) }
    var mode by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(title.tmdbId, season, episode) {
        vm.authorize(title.tmdbId, season, episode) { u, m, msg ->
            url = u
            mode = m
            message = msg
            loading = false
        }
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
                            doToggle(native.repeatCount); true
                        }
                        Key.DirectionLeft, Key.MediaRewind -> {
                            doSeekDown(-1, native.repeatCount); true
                        }
                        Key.DirectionRight, Key.MediaFastForward -> {
                            doSeekDown(1, native.repeatCount); true
                        }
                        // ↑ ↓ são consumidas para o foco não escapar do player.
                        Key.DirectionUp, Key.DirectionDown -> true
                        else -> false
                    }
                    KeyEventType.KeyUp -> when (ev.key) {
                        Key.DirectionLeft, Key.DirectionRight,
                        Key.MediaRewind, Key.MediaFastForward,
                        -> {
                            doSeekUp(); true
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
        TvProgressBar(position = positionState.value, duration = durationState.value, visible = ui.visible)
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
  var S = { v: null, playing: false, t: 0, d: 0, ready: false, tried: 0, autoTried: 0 };
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
      if (!document.getElementById('__mf_clean')) {
        var st = document.createElement('style');
        st.id = '__mf_clean';
        st.textContent = [
          '#ui, .ui, #reportWrap, .report-wrap, #toast, .toast, .scrim-top',
          '#episodesView, #episodes, .ep-season-row, .ep-season-select',
          '.top-actions, .source-trigger, .icon-btn, .next-btn, .prev-btn',
          '.panel, .panel-body-wrap, .panel-list, .title-wrap, .crumb',
          '.brand-container, .pro-loader, #playerLoader, .loading-wrapper',
          '.controls, .control-bar, .player-controls, .settings, .settings-panel',
          '.volume, .volume-control, .subtitle, .subtitles, .quality, .fullscreen',
        ].join(',') + '{display:none !important;visibility:hidden !important;opacity:0 !important;pointer-events:none !important;}' +
          // Nenhum anel/borda de foco, em nenhum elemento, em nenhum estado.
          '*:focus{outline:none !important;outline-offset:0 !important;box-shadow:none !important;}' +
          '*:focus-visible{outline:none !important;box-shadow:none !important;}' +
          '*::-moz-focus-inner{border:0 !important;}' +
          'video::-webkit-media-controls{display:none !important;}' +
          'video::-webkit-media-controls-enclosure{display:none !important;}';
        (document.head || document.documentElement).appendChild(st);
      }

      // O selo "embedmovies.org" é um <span> solto no body, sem classe.
      var spans = document.querySelectorAll('body > span');
      for (var i = 0; i < spans.length; i++) {
        var s = spans[i];
        if (s && /embedmovies|embed/i.test(s.textContent || '')) {
          s.style.display = 'none';
        }
      }

      // Se o provedor focar algum elemento por conta própria, tira o foco.
      // É isto que impede o anel amarelo de reaparecer depois de um clique.
      var ae = document.activeElement;
      if (ae && ae !== document.body && typeof ae.blur === 'function') {
        ae.blur();
      }
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

  function post(o) {
    try {
      if (window.MfPlayer && window.MfPlayer.post) window.MfPlayer.post(JSON.stringify(o));
    } catch (e) {}
  }

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
  setInterval(hideProviderUi, 500);

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
    if (!attach()) { post({ type: 'novideo' }); return false; }
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
      sync();
      post(snapshot());
      return true;
    } catch (e) { return false; }
  };

  post({ type: 'ready' });
})();
""".trimIndent()

/** Recebe o estado do `<video>` vindo do JS. */
private class PlayerBridge(private val onMessage: (String) -> Unit) {
    @JavascriptInterface
    fun post(json: String) = onMessage(json)
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
    /** API < 30: sem `addDocumentStartJavaScript`, injeta no onPageFinished. */
    var legacyBridge by remember { mutableStateOf(false) }

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
                            doToggle(native.repeatCount); true
                        }
                        Key.DirectionLeft, Key.MediaRewind -> {
                            doSeekDown(-1, native.repeatCount); true
                        }
                        Key.DirectionRight, Key.MediaFastForward -> {
                            doSeekDown(1, native.repeatCount); true
                        }
                        // ↑ ↓ consumidas: o foco não pode escapar do player.
                        Key.DirectionUp, Key.DirectionDown -> true
                        Key.Back -> {
                            onBack(); true
                        }
                        else -> false
                    }
                    KeyEventType.KeyUp -> when (ev.key) {
                        Key.DirectionLeft, Key.DirectionRight,
                        Key.MediaRewind, Key.MediaFastForward,
                        -> {
                            doSeekUp(); true
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
                        userAgentString = "$userAgentString MovieFlixTV/1.0"
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

                    // Rede de segurança: se algum aparelho ainda entregar teclas
                    // ao WebView, consumimos tudo aqui também (nunca devolvemos
                    // false para o D-pad, senão o DOM voltaria a navegar).
                    setOnKeyListener { _, keyCode, event ->
                        when (event.action) {
                            KeyEvent.ACTION_DOWN -> when (keyCode) {
                                KeyEvent.KEYCODE_DPAD_CENTER,
                                KeyEvent.KEYCODE_ENTER,
                                KeyEvent.KEYCODE_NUMPAD_ENTER,
                                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                                KeyEvent.KEYCODE_MEDIA_PLAY,
                                KeyEvent.KEYCODE_MEDIA_PAUSE,
                                -> {
                                    doToggle(event.repeatCount); true
                                }
                                KeyEvent.KEYCODE_DPAD_RIGHT,
                                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
                                -> {
                                    doSeekDown(1, event.repeatCount); true
                                }
                                KeyEvent.KEYCODE_DPAD_LEFT,
                                KeyEvent.KEYCODE_MEDIA_REWIND,
                                -> {
                                    doSeekDown(-1, event.repeatCount); true
                                }
                                KeyEvent.KEYCODE_DPAD_UP,
                                KeyEvent.KEYCODE_DPAD_DOWN,
                                -> true
                                KeyEvent.KEYCODE_BACK -> {
                                    onBack(); true
                                }
                                else -> false
                            }
                            KeyEvent.ACTION_UP -> when (keyCode) {
                                KeyEvent.KEYCODE_DPAD_RIGHT,
                                KeyEvent.KEYCODE_DPAD_LEFT,
                                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
                                KeyEvent.KEYCODE_MEDIA_REWIND,
                                -> {
                                    doSeekUp(); true
                                }
                                else -> false
                            }
                            else -> false
                        }
                    }

                    webView = this
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
        if (pageReady && !hasVideo && !failed && waitedLong) {
            Text(
                "O provedor não liberou o vídeo para este aparelho.",
                color = MfColors.TextMuted,
                fontSize = 15.sp,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 40.dp),
            )
        }

        // A ÚNICA coisa desenhada sobre o vídeo: a barra de progresso.
        TvProgressBar(position = positionState.value, duration = durationState.value, visible = ui.visible)
    }
}

// ────────────────────────────────── barra ──────────────────────────────────

/**
 * A barra de progresso — e SÓ ela.
 *
 * Sem ícone de play/pause, sem tempo escrito, sem dica de teclas, sem título,
 * sem painel, sem moldura. É o que o proprietário pediu: "somente a barra de
 * progresso". Fica colada na borda inferior, fina e discreta, para não cobrir
 * o filme.
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
            // Tempo atual / duração total — os números vêm do player real.
            Text(
                "${formatClock(position)} / ${formatClock(duration)}",
                color = Color(0xE6FFFFFF),
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(bottom = 6.dp),
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

/** Hosts do provedor que podem navegar dentro do WebView. */
private fun isProviderHost(host: String): Boolean =
    host.contains("myembed") ||
        host.contains("playerflix") ||
        host.contains("streambetter") ||
        host.contains("cloudflare") ||
        host.contains("challenges.")
