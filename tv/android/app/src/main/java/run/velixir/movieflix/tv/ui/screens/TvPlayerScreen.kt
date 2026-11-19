package run.velixir.movieflix.tv.ui.screens

import android.annotation.SuppressLint
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import run.velixir.movieflix.tv.TvViewModel
import run.velixir.movieflix.tv.data.Title
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfSans

/**
 * Player da TV.
 *
 * Controle remoto (os dois modos):
 *   OK / Enter            → play/pause de verdade
 *   ← / →                 → toque curto: ±10 s. Segurando: 30 s, 1 min, 2 min,
 *                           3 min, 4 min, e depois 4 min por repetição
 *   ↑ / ↓                 → volume ±10 %
 *   Voltar                → sai do player
 *
 * ── Por que o OK não funcionava no modo embed ──────────────────────────────
 *
 * O player do provedor roda em iframe de OUTRO domínio. A página do MovieFlix
 * não alcança o `<video>` de dentro dele (política de origem do navegador), e
 * o provedor não publica `postMessage` — verificado em 2026-11-18: a página do
 * playerflix.ink devolve 0 bytes para requisição direta e não expõe canal.
 *
 * No Android, porém, existe um caminho que o navegador não tem:
 * `WebView.addDocumentStartJavaScript` injeta um script em TODOS os frames,
 * inclusive nos de outra origem. É por ele que a ponte abaixo alcança o
 * `<video>` real do provedor e o controla de verdade — não é um ícone mudando,
 * é `video.play()` / `video.pause()` / `video.currentTime` no elemento.
 *
 * O estado que aparece na barrinha vem do próprio `<video>` (eventos
 * `timeupdate`, `play`, `pause`, `durationchange`), não de um contador
 * estimado. Se o provedor não tiver `<video>` (ex.: player em canvas), a ponte
 * não encontra o elemento e o app diz isso na tela, em vez de fingir.
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

// ─────────────────────────── modo direto (Media3) ───────────────────────────

@Composable
private fun TvDirectPlayer(
    url: String,
    title: Title,
    season: Int?,
    episode: Int?,
    vm: TvViewModel,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
            playWhenReady = true
        }
    }

    var playing by remember { mutableStateOf(true) }
    var position by remember { mutableStateOf(0.0) }
    var duration by remember { mutableStateOf(0.0) }
    var volume by remember { mutableStateOf(1.0) }
    var hint by remember { mutableStateOf<String?>(null) }
    var seekJob by remember { mutableStateOf<Job?>(null) }

    DisposableEffect(Unit) { onDispose { player.release() } }

    // Estado real do ExoPlayer → barrinha.
    LaunchedEffect(Unit) {
        while (true) {
            playing = player.isPlaying
            position = (player.currentPosition / 1000.0).coerceAtLeast(0.0)
            duration = (player.duration / 1000.0).coerceAtLeast(0.0)
            volume = player.volume
            delay(250)
        }
    }

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

    fun toggle() {
        if (player.isPlaying) player.pause() else player.play()
        hint = if (player.isPlaying) "▶ Reproduzindo" else "⏸ Pausado"
    }

    fun seekBy(seconds: Double) {
        val dur = player.duration
        val target = (player.currentPosition + (seconds * 1000).toLong())
            .coerceIn(0L, if (dur > 0) dur else Long.MAX_VALUE)
        player.seekTo(target)
        hint = if (seconds > 0) "⏩ +${seconds.toInt()}s" else "⏪ ${seconds.toInt()}s"
    }

    fun startSeek(dir: Int) {
        seekJob?.cancel()
        seekBy(dir * 10.0)
        seekJob = scope.launch {
            delay(600)
            for (s in listOf(30.0, 60.0, 120.0, 180.0, 240.0)) {
                seekBy(dir * s)
                delay(500)
            }
            while (isActive) {
                seekBy(dir * 240.0)
                delay(500)
            }
        }
    }

    fun changeVolume(delta: Double) {
        val v = (player.volume + delta).coerceIn(0.0, 1.0)
        player.volume = v
        hint = "🔊 ${(v * 100).toInt()}%"
    }

    LaunchedEffect(hint) {
        if (hint != null) {
            delay(1200)
            hint = null
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .onKeyEvent { ev ->
                if (ev.type != KeyEventType.KeyDown) return@onKeyEvent false
                when (ev.key) {
                    Key.DirectionCenter, Key.Enter, Key.Spacebar, Key.MediaPlayPause -> {
                        toggle(); true
                    }
                    Key.DirectionLeft, Key.MediaRewind -> {
                        if (ev.nativeKeyEvent.repeatCount == 0) startSeek(-1); true
                    }
                    Key.DirectionRight, Key.MediaFastForward -> {
                        if (ev.nativeKeyEvent.repeatCount == 0) startSeek(1); true
                    }
                    Key.DirectionUp -> {
                        if (ev.nativeKeyEvent.repeatCount == 0) changeVolume(0.1); true
                    }
                    Key.DirectionDown -> {
                        if (ev.nativeKeyEvent.repeatCount == 0) changeVolume(-0.1); true
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
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        TvPlayerOverlay(
            playing = playing,
            position = position,
            duration = duration,
            volume = volume,
            hint = hint,
        )
    }
}

// ─────────────────────────── modo embed (WebView) ───────────────────────────

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
 *   3. expõe `window.__mfCmd(cmd, arg)` para o app mandar play/pause/seek/volume.
 */
private val BRIDGE_JS: String = """
(function () {
  if (window.__mf) return;
  var S = { v: null, playing: false, t: 0, d: 0, vol: 1, muted: false, ready: false, tried: 0 };
  window.__mf = S;

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

  function attach() {
    var v = pick();
    if (!v) return false;
    if (v !== S.v) {
      S.v = v;
      var evs = ['play','playing','pause','timeupdate','durationchange','loadedmetadata',
                 'volumechange','ended','seeking','seeked','canplay'];
      for (var i = 0; i < evs.length; i++) {
        v.addEventListener(evs[i], function () { sync(); post({ type: 'state' }); }, true);
      }
      // O provedor costuma montar o vídeo já pausado. Tenta tocar assim que o
      // elemento existe; se o navegador recusar, o OK do controle resolve.
      try { if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function(){}); } } catch (e) {}
    }
    sync();
    return true;
  }

  var iv = setInterval(function () {
    S.tried++;
    if (attach() || S.tried > 600) clearInterval(iv);
  }, 250);

  window.__mfCmd = function (cmd, arg) {
    if (!attach()) { post({ type: 'novideo' }); return false; }
    var v = S.v;
    try {
      if (cmd === 'toggle') { if (v.paused) { v.play(); } else { v.pause(); } }
      else if (cmd === 'play') { v.play(); }
      else if (cmd === 'pause') { v.pause(); }
      else if (cmd === 'seekBy') {
        var d = isFinite(v.duration) ? v.duration : 0;
        var t = (v.currentTime || 0) + arg;
        v.currentTime = Math.max(0, d > 0 ? Math.min(d, t) : t);
      }
      else if (cmd === 'vol') { v.muted = false; v.volume = Math.max(0, Math.min(1, arg)); }
      else if (cmd === 'mute') { v.muted = !v.muted; }
      sync();
      post({ type: 'state' });
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
    var playing by remember { mutableStateOf(false) }
    var position by remember { mutableStateOf(0.0) }
    var duration by remember { mutableStateOf(0.0) }
    var volume by remember { mutableStateOf(1.0) }
    var hasVideo by remember { mutableStateOf(false) }
    var hint by remember { mutableStateOf<String?>(null) }
    /** API < 30: sem `addDocumentStartJavaScript`, injeta no onPageFinished. */
    var legacyBridge by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()
    var seekJob by remember { mutableStateOf<Job?>(null) }

    fun js(cmd: String, arg: Double? = null) {
        val a = arg?.let { ",$it" } ?: ""
        webView?.evaluateJavascript("window.__mfCmd && window.__mfCmd('$cmd'$a)", null)
    }

    fun toggle() {
        js("toggle")
        hint = if (playing) "⏸ Pausado" else "▶ Reproduzindo"
    }

    fun seekBy(seconds: Double) {
        js("seekBy", seconds)
        hint = if (seconds > 0) "⏩ +${seconds.toInt()}s" else "⏪ ${seconds.toInt()}s"
    }

    /**
     * Toque curto = 10 s. Segurando, os saltos crescem: 30 s, 1 min, 2 min,
     * 3 min, 4 min — e daí em diante 4 min por repetição. Ao soltar, o job é
     * cancelado e o vídeo fica exatamente onde parou; a barrinha mostra a
     * posição real que o `<video>` reporta.
     */
    fun startSeek(dir: Int) {
        seekJob?.cancel()
        seekBy(dir * 10.0)
        seekJob = scope.launch {
            delay(600)
            for (s in listOf(30.0, 60.0, 120.0, 180.0, 240.0)) {
                seekBy(dir * s)
                delay(500)
            }
            while (isActive) {
                seekBy(dir * 240.0)
                delay(500)
            }
        }
    }

    fun stopSeek() {
        seekJob?.cancel()
        seekJob = null
    }

    fun changeVolume(delta: Double) {
        val v = (volume + delta).coerceIn(0.0, 1.0)
        volume = v
        js("vol", v)
        hint = "🔊 ${(v * 100).toInt()}%"
    }

    LaunchedEffect(hint) {
        if (hint != null) {
            delay(1200)
            hint = null
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            seekJob?.cancel()
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
                                        playing = o.optBoolean("playing", false)
                                        position = o.optDouble("t", 0.0)
                                        duration = o.optDouble("d", 0.0)
                                        volume = o.optDouble("vol", 1.0)
                                        hasVideo = o.optBoolean("ready", false)
                                    }
                                    "novideo" -> hasVideo = false
                                }
                            }
                        },
                        "MfPlayer",
                    )

                    // Script em todos os frames, inclusive os de outra origem.
                    //
                    // `addDocumentStartJavaScript` só existe a partir da API 30.
                    // Chamar sem guarda derrubaria o app em Android TV 8/9
                    // (API 26-29), que ainda é comum em TV Box. Abaixo da 30
                    // caímos para `evaluateJavascript`, que alcança apenas o
                    // frame principal — funciona quando o provedor monta o
                    // <video> na própria página, e é o máximo que a API antiga
                    // permite. A limitação é dita na tela, não escondida.
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                        addDocumentStartJavaScript(BRIDGE_JS, setOf("*"))
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
                        if (event.action == KeyEvent.ACTION_DOWN) {
                            when (keyCode) {
                                KeyEvent.KEYCODE_DPAD_CENTER,
                                KeyEvent.KEYCODE_ENTER,
                                KeyEvent.KEYCODE_NUMPAD_ENTER,
                                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                                    if (event.repeatCount == 0) toggle()
                                    true
                                }
                                KeyEvent.KEYCODE_DPAD_RIGHT,
                                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                                    if (event.repeatCount == 0) startSeek(1)
                                    true
                                }
                                KeyEvent.KEYCODE_DPAD_LEFT,
                                KeyEvent.KEYCODE_MEDIA_REWIND -> {
                                    if (event.repeatCount == 0) startSeek(-1)
                                    true
                                }
                                KeyEvent.KEYCODE_DPAD_UP -> {
                                    if (event.repeatCount == 0) changeVolume(0.1)
                                    true
                                }
                                KeyEvent.KEYCODE_DPAD_DOWN -> {
                                    if (event.repeatCount == 0) changeVolume(-0.1)
                                    true
                                }
                                KeyEvent.KEYCODE_BACK -> {
                                    onBack()
                                    true
                                }
                                else -> false
                            }
                        } else if (event.action == KeyEvent.ACTION_UP) {
                            when (keyCode) {
                                KeyEvent.KEYCODE_DPAD_RIGHT,
                                KeyEvent.KEYCODE_DPAD_LEFT,
                                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
                                KeyEvent.KEYCODE_MEDIA_REWIND -> {
                                    stopSeek()
                                    true
                                }
                                else -> false
                            }
                        } else false
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
            playing = playing,
            position = position,
            duration = duration,
            volume = volume,
            hint = hint,
        )
    }
}

// ─────────────────────────────── overlay ───────────────────────────────

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
    volume: Double,
    hint: String?,
) {
    val pct = if (duration > 0) (position / duration).coerceIn(0.0, 1.0) else 0.0

    Box(Modifier.fillMaxSize()) {
        // Dica de comando (⏩ +10s, 🔊 70%, ⏸ Pausado…)
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

                Text(
                    "🔊 ${(volume * 100).toInt()}%",
                    color = MfColors.TextMuted,
                    fontSize = 14.sp,
                    fontFamily = MfSans,
                )
            }

            Spacer(Modifier.height(8.dp))

            Text(
                "OK play/pause · ← → 10s (segure para acelerar) · ↑ ↓ volume",
                color = MfColors.TextDim,
                fontSize = 12.sp,
                fontFamily = MfSans,
            )
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
