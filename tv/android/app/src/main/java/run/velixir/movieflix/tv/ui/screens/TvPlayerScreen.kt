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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.graphics.Brush
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
import run.velixir.movieflix.tv.ui.theme.MfSans

/**
 * Player da TV.
 *
 * ── Controle remoto (o que o usuário pediu) ──────────────────────────────────
 *
 *   OK / Enter / Play-Pause → alterna play/pause, sempre a partir do estado REAL
 *   →  toque curto          → +10 s
 *   →  segurando            → +30 s, +1 min, +2 min, +3 min, +4 min (e 4 min)
 *   ←  toque curto          → −10 s
 *   ←  segurando            → −30 s, −1 min, −2 min, −3 min, −4 min
 *   soltar                  → para EXATAMENTE no alvo (seek absoluto)
 *   Voltar                  → sai do player
 *
 * Volume NÃO existe mais: o proprietário pediu para remover volume, legendas,
 * tela cheia, ajustes e troca de servidor. ↑ ↓ são consumidas (para o foco não
 * escapar do player) e não fazem nada.
 *
 * ── O que mudou nesta versão (e por quê) ─────────────────────────────────────
 *
 * 1. A lógica de controle saiu daqui e foi para `player/TvPlayerControls.kt`,
 *    que é Kotlin puro e tem testes headless (`scripts/test-tv-player.sh`).
 *    Antes ela era impossível de testar e divergia do aparelho real.
 *
 * 2. O avanço passou a ser ABSOLUTO. Antes cada passo era
 *    `currentTime + 10`, então o segundo passo partia de uma posição que o
 *    player ainda não tinha aplicado — segurando a seta os saltos se perdiam e
 *    o vídeo não parava no número exato. Agora o alvo é acumulado em segundos
 *    e enviado como `seekTo(alvo)`; soltar reenvia o mesmo alvo.
 *
 * 3. Passou a existir tratamento de SOLTAR a tecla (ACTION_UP) nos dois modos.
 *    No modo direto (ExoPlayer) não havia: o job de avanço rodava para sempre,
 *    pulando 4 min a cada 500 ms depois que o usuário soltava.
 *
 * 4. Watchdog de 1,2 s: TV Box que não entrega ACTION_UP ao WebView não deixa
 *    mais o vídeo avançando sozinho.
 *
 * 5. O vídeo começa a tocar ao abrir. O provedor costuma montar o `<video>`
 *    pausado; a ponte tenta `play()` assim que o elemento existe e de novo em
 *    `canplay`, e o ExoPlayer usa `playWhenReady = true` com uma retentativa.
 *    Se ainda assim entrar pausado, o primeiro OK despausa — porque o toggle
 *    lê `v.paused` / `isPlaying` de verdade, em vez de um contador do app.
 *
 * ── Por que o modo embed precisa de ponte JS ─────────────────────────────────
 *
 * O player do provedor roda em iframe de OUTRO domínio. A página do MovieFlix
 * não alcança o `<video>` de dentro dele (política de origem do navegador) e o
 * provedor não publica `postMessage`. No Android existe um caminho que o
 * navegador não tem: `WebViewCompat.addDocumentStartJavaScript` injeta um
 * script em TODOS os frames, inclusive nos de outra origem. É por ele que a
 * ponte abaixo controla o `<video>` real — `play()`, `pause()`, `currentTime`,
 * `volume` no elemento, não um ícone mudando.
 *
 * O estado da barrinha vem do próprio `<video>` (eventos `timeupdate`, `play`,
 * `pause`, `durationchange`), não de um contador estimado. Se o provedor não
 * tiver `<video>` (ex.: player em canvas), a ponte não encontra o elemento e o
 * app diz isso na tela, em vez de fingir.
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

// ───────────────────────────── modo direto (Media3) ─────────────────────────────

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

    // Estado REAL do ExoPlayer — é o que a barrinha mostra e o que o toggle lê.
    val playingState = remember { mutableStateOf(true) }
    val positionState = remember { mutableStateOf(0.0) }
    val durationState = remember { mutableStateOf(0.0) }

    var hint by remember { mutableStateOf<String?>(null) }
    /** O usuário pausou de propósito: a retentativa de autoplay não deve brigar. */
    var userPaused by remember { mutableStateOf(false) }
    /** Controles na tela — somem 3 s depois da última tecla. */
    val ui = remember { UiVisibility() }
    var controlsVisible by remember { mutableStateOf(true) }

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

    DisposableEffect(Unit) { onDispose { player.release() } }

    // Foco: sem isto o Compose não recebe as teclas do controle.
    LaunchedEffect(Unit) {
        runCatching { focusRequester.requestFocus() }
    }

    // Estado real → barrinha (4× por segundo).
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
            // OK sem efeito → reenvia play/pause EXPLÍCITO (um toque basta).
            toggle.retry(now)
            // Auto-hide: sem tecla há 3 s, some com os controles.
            ui.tick(now)
            controlsVisible = ui.visible
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

    LaunchedEffect(hint) {
        if (hint != null) {
            delay(1200)
            hint = null
        }
    }

    fun doToggle(repeatCount: Int) {
        // Auto-repeat do controle: só o PRIMEIRO evento (repeatCount 0) conta.
        // Antes, o auto-repeat gerava dois toggles no mesmo toque e o vídeo
        // voltava ao estado anterior — era isso que exigia apertar OK várias
        // vezes para conseguir pausar.
        if (repeatCount > 0) return
        if (!toggle.onKey(SystemClock.uptimeMillis())) return
        ui.poke(SystemClock.uptimeMillis())
        hint = toggle.hint()
        if (player.isPlaying) {
            userPaused = true
            player.pause()
        } else {
            userPaused = false
            player.play()
        }
    }

    fun doSeekDown(dir: Int, repeatCount: Int) {
        ui.poke(SystemClock.uptimeMillis())
        if (seek.onKeyDown(dir, repeatCount, SystemClock.uptimeMillis())) {
            hint = seek.stepLabel()
        }
    }

    fun doSeekUp() {
        if (seek.onKeyUp(SystemClock.uptimeMillis())) hint = seek.stepLabel()
    }

    Box(
        Modifier
            .fillMaxSize()
            .focusRequester(focusRequester)
            .focusable()
            .onKeyEvent { ev ->
                val native = ev.nativeKeyEvent
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
                        Key.DirectionUp -> {
                            // Volume removido a pedido do proprietário. A tecla é
                            // consumida para o foco não escapar do player.
                            ui.poke(SystemClock.uptimeMillis())
                            true
                        }
                        Key.DirectionDown -> {
                            ui.poke(SystemClock.uptimeMillis())
                            true
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
                PlayerView(ctx).apply {
                    this.player = player
                    useController = false
                    isFocusable = false
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        TvPlayerOverlay(
            playing = playingState.value,
            position = positionState.value,
            duration = durationState.value,
            hint = hint,
            visible = controlsVisible,
            // Modo DIRETO: não há player de terceiro, então esta é a única
            // barra da tela.
            showBar = true,
        )
    }
}

// ───────────────────────────── modo embed (WebView) ─────────────────────────────

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
 *   4. expõe `window.__mfCmd(cmd, arg)` para o app mandar
 *      toggle / play / pause / seekTo / seekBy / vol.
 *
 * `seekTo` recebe a posição ABSOLUTA em segundos — é o que faz o vídeo parar
 * exatamente no ponto mostrado na barra, sem deriva.
 */
private val BRIDGE_JS: String = """
(function () {
  if (window.__mf) return;
  var S = { v: null, playing: false, t: 0, d: 0, vol: 1, muted: false, ready: false, tried: 0, autoTried: 0 };
  window.__mf = S;

  /**
   * Esconde a UI do provedor.
   *
   * O proprietário pediu um player limpo: só OK (pausar/continuar), ← → 10 s e
   * a barra de progresso. Nada de configurações, volume, legendas, tela cheia,
   * seleção de servidor ou ícones extras.
   *
   * O player do provedor (playerflix.ink) desenha a barra dele dentro do
   * iframe: `#ui` (controles), `.scrim-top`, `#reportWrap` (denúncia),
   * `#toast`, o selo "embedmovies.org" e a view de episódios. Escondemos esses
   * elementos por CSS — a barra que sobra na tela é a do app, que é a única
   * com os números reais do <video>.
   *
   * O <video> em si NUNCA é escondido: é ele que toca o filme.
   */
  function hideProviderUi() {
    if (document.getElementById('__mf_clean')) return;
    var st = document.createElement('style');
    st.id = '__mf_clean';
    st.textContent = [
      '#ui, .ui, #reportWrap, .report-wrap, #toast, .toast, .scrim-top,',
      '#episodesView, #episodes, .ep-season-row, .ep-season-select,',
      '.top-actions, .source-trigger, .icon-btn, .next-btn, .prev-btn,',
      '.panel, .panel-body-wrap, .panel-list, .title-wrap, .crumb,',
      '.brand-container, .pro-loader, #playerLoader, .loading-wrapper',
    ].join(',') + '{display:none !important;visibility:hidden !important;opacity:0 !important;pointer-events:none !important;}' +
      'video::-webkit-media-controls{display:none !important;}' +
      'video::-webkit-media-controls-enclosure{display:none !important;}';
    (document.head || document.documentElement).appendChild(st);

    // O selo "embedmovies.org" é um <span> solto no body, sem classe.
    var spans = document.querySelectorAll('body > span');
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i];
      if (s && /embedmovies|embed/i.test(s.textContent || '')) {
        s.style.display = 'none';
      }
    }
  }

  hideProviderUi();
  setInterval(hideProviderUi, 1000);

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
    return {
      type: 'state',
      playing: S.playing,
      t: S.t,
      d: S.d,
      vol: S.vol,
      muted: S.muted,
      ready: S.ready
    };
  }

  function sync() {
    var v = S.v;
    if (!v) return;
    S.playing = !v.paused && !v.ended;
    S.t = v.currentTime || 0;
    S.d = (isFinite(v.duration) ? v.duration : 0);
    S.vol = (typeof v.volume === 'number') ? v.volume : 1;
    S.muted = !!v.muted;
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

  var iv = setInterval(function () {
    S.tried++;
    if (attach() || S.tried > 600) clearInterval(iv);
  }, 250);

  // Tenta já, sem esperar o primeiro tick: quando o script é injetado no
  // document-start o <video> normalmente ainda não existe, mas em recarregamento
  // de frame ele já pode estar lá — e aí o autoplay acontece 250 ms mais cedo.
  attach();

  // Heartbeat: mantém a barrinha viva mesmo se o provedor não emitir eventos.
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
      else if (cmd === 'seekBy') {
        var d2 = isFinite(v.duration) ? v.duration : 0;
        var t2 = (v.currentTime || 0) + Number(arg);
        v.currentTime = Math.max(0, d2 > 0 ? Math.min(d2, t2) : t2);
      }
      else if (cmd === 'vol') { v.muted = false; v.volume = Math.max(0, Math.min(1, Number(arg))); }
      else if (cmd === 'mute') { v.muted = !v.muted; }
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
    var hint by remember { mutableStateOf<String?>(null) }
    /** API < 30: sem `addDocumentStartJavaScript`, injeta no onPageFinished. */
    var legacyBridge by remember { mutableStateOf(false) }
    /** Controles na tela — somem 3 s depois da última tecla. */
    val ui = remember { UiVisibility() }
    var controlsVisible by remember { mutableStateOf(true) }

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
        ui.poke(SystemClock.uptimeMillis())
        hint = toggle.hint()
        js("toggle")
    }

    fun doSeekDown(dir: Int, repeatCount: Int) {
        ui.poke(SystemClock.uptimeMillis())
        if (seek.onKeyDown(dir, repeatCount, SystemClock.uptimeMillis())) {
            hint = seek.stepLabel()
        }
    }

    fun doSeekUp() {
        if (seek.onKeyUp(SystemClock.uptimeMillis())) hint = seek.stepLabel()
    }

    // Relógio do controle: aceleração progressiva + watchdog de soltura +
    // reenvio do OK se o player não obedeceu + auto-hide dos controles.
    LaunchedEffect(Unit) {
        while (true) {
            val now = SystemClock.uptimeMillis()
            seek.tick(now)
            // O player do provedor às vezes ignora o primeiro toggle (iframe
            // ainda montando). Se o estado não mudou, manda play/pause
            // EXPLÍCITO — nunca outro toggle, para não desfazer o que deu certo.
            toggle.retry(now)?.let { want -> js(if (want) "play" else "pause") }
            ui.tick(now)
            controlsVisible = ui.visible
            delay(50)
        }
    }

    LaunchedEffect(hint) {
        if (hint != null) {
            delay(1200)
            hint = null
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

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    setBackgroundColor(android.graphics.Color.BLACK)
                    isFocusable = true
                    isFocusableInTouchMode = true
                    requestFocus()

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
                    //
                    // `addDocumentStartJavaScript` é do androidx.webkit (não da
                    // classe WebView da plataforma) e só existe a partir da API
                    // 30. Abaixo disso caímos para `evaluateJavascript`, que
                    // alcança apenas o frame principal — funciona quando o
                    // provedor monta o <video> na própria página, e é o máximo
                    // que a API antiga permite. A limitação é dita na tela.
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

                    // O WebView consome as teclas antes do Compose; o listener
                    // aqui é o único ponto que vê o D-pad primeiro.
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
                                KeyEvent.KEYCODE_DPAD_UP -> {
                                    // Volume removido a pedido do proprietário.
                                    ui.poke(SystemClock.uptimeMillis())
                                    true
                                }
                                KeyEvent.KEYCODE_DPAD_DOWN -> {
                                    ui.poke(SystemClock.uptimeMillis())
                                    true
                                }
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

        // Aviso honesto: a página abriu mas não há <video> para controlar.
        if (pageReady && !hasVideo && !failed) {
            Text(
                "O provedor não liberou o vídeo para este aparelho.",
                color = MfColors.TextMuted,
                fontSize = 15.sp,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 90.dp),
            )
        }

        TvPlayerOverlay(
            playing = playingState.value,
            position = positionState.value,
            duration = durationState.value,
            hint = hint,
            visible = controlsVisible,
            // Modo EMBED: a UI do provedor é escondida pela ponte JS
            // (`hideProviderUi`), então esta é a ÚNICA barra na tela — a que o
            // proprietário pediu: tempo atual, duração e progresso.
            showBar = true,
        )
    }
}

// ───────────────────────────────── overlay ─────────────────────────────────

/**
 * Barrinha de progresso + indicador de estado.
 *
 * Os números vêm do `<video>` real (ou do ExoPlayer, no modo direto) — não de
 * um contador estimado. Quando a duração ainda não é conhecida, mostra só o
 * tempo decorrido em vez de inventar uma porcentagem.
 */
@Composable
private fun TvPlayerOverlay(
    playing: Boolean,
    position: Double,
    duration: Double,
    hint: String?,
    visible: Boolean,
    /** Desenha a barra própria da MovieFlix. */
    showBar: Boolean,
) {
    val pct = if (duration > 0) (position / duration).coerceIn(0.0, 1.0) else 0.0

    Box(Modifier.fillMaxSize()) {
        // Dica de comando (⏩ +10s, ⏸ Pausado…)
        // A dica aparece SEMPRE, mesmo com os controles escondidos: é a única
        // confirmação visual de que a tecla do controle foi entendida.
        if (hint != null) {
            Text(
                hint,
                color = Color.White,
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = MfSans,
                modifier = Modifier
                    .align(Alignment.Center)
                    .background(Color(0xCC000000), RoundedCornerShape(12.dp))
                    .padding(horizontal = 26.dp, vertical = 14.dp),
            )
        }

        // Barra de controles: some 3 s depois da última tecla (o usuário pediu
        // para ficar só o filme na tela) e volta em qualquer tecla.
        if (showBar && visible) {
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color.Transparent, Color(0xE6000000)),
                        ),
                    )
                    .padding(horizontal = 48.dp, vertical = 26.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(
                        if (playing) "⏸" else "▶",
                        color = Color.White,
                        fontSize = 20.sp,
                    )
                    Text(
                        formatClock(position),
                        color = Color.White,
                        fontSize = 15.sp,
                        fontFamily = MfSans,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        "/",
                        color = MfColors.TextDim,
                        fontSize = 15.sp,
                    )
                    Text(
                        if (duration > 0) formatClock(duration) else "—",
                        color = MfColors.TextMuted,
                        fontSize = 15.sp,
                        fontFamily = MfSans,
                    )

                    Spacer(Modifier.width(6.dp))

                    // Trilha
                    Box(
                        Modifier
                            .weight(1f)
                            .height(6.dp)
                            .background(Color(0x33FFFFFF), RoundedCornerShape(3.dp)),
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth(pct.toFloat())
                                .height(6.dp)
                                .background(MfColors.Red, RoundedCornerShape(3.dp)),
                        )
                    }

                    Spacer(Modifier.width(6.dp))
                }

                Spacer(Modifier.height(8.dp))

                Text(
                    "OK pausar/continuar · ← → 10s",
                    color = MfColors.TextDim,
                    fontSize = 12.sp,
                    fontFamily = MfSans,
                )
            }
        }
    }
}

/** 3725.0 → "1:02:05" */
private fun formatClock(seconds: Double): String {
    if (!seconds.isFinite() || seconds < 0) return "0:00"
    val total = seconds.toLong()
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "$h:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}"
    else "$m:${s.toString().padStart(2, '0')}"
}

/** Hosts do provedor que podem navegar dentro do WebView. */
private fun isProviderHost(host: String): Boolean =
    host.contains("myembed") ||
        host.contains("playerflix") ||
        host.contains("streambetter") ||
        host.contains("cloudflare") ||
        host.contains("challenges.")
