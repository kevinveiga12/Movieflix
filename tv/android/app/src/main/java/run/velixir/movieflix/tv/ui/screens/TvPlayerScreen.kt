package run.velixir.movieflix.tv.ui.screens

import android.annotation.SuppressLint
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import run.velixir.movieflix.tv.TvViewModel
import run.velixir.movieflix.tv.data.Title
import run.velixir.movieflix.tv.ui.theme.MfColors

/**
 * Player da TV.
 *
 * Controle remoto:
 *   OK / Enter / D-pad center → play/pause
 *   ← / →                     → retrocede / avança 10s
 *   ↑ / ↓                     → mostra os controles
 *   Voltar                    → sai do player
 *
 * Modo "direct" (MP4/HLS) usa Media3: os comandos acima são aplicados
 * diretamente no ExoPlayer, com precisão.
 *
 * Modo "embed" (página do provedor) roda em WebView. Aqui está a limitação
 * real, e ela é dita sem rodeio: uma página de terceiros dentro de WebView
 * NÃO expõe uma API de reprodução, então não há como garantir que o provedor
 * responda a play/pause/seek. O que o app faz é repassar as teclas ao WebView
 * e manter o bloqueio de pop-up e de navegação externa. Para controle total
 * na TV, a fonte precisa ser um arquivo (MP4/HLS) — aí o Media3 assume.
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

            url != null -> TvEmbedPlayer(url!!)
        }
    }
}

@Composable
private fun TvDirectPlayer(
    url: String,
    title: Title,
    season: Int?,
    episode: Int?,
    vm: TvViewModel,
) {
    val context = LocalContext.current
    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
            playWhenReady = true
        }
    }

    DisposableEffect(Unit) { onDispose { player.release() } }

    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(10_000)
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

    Box(
        Modifier
            .fillMaxSize()
            .onKeyEvent { ev ->
                if (ev.type != KeyEventType.KeyDown) return@onKeyEvent false
                when (ev.key) {
                    Key.DirectionCenter, Key.Enter, Key.Spacebar -> {
                        if (player.isPlaying) player.pause() else player.play()
                        true
                    }
                    Key.DirectionLeft -> {
                        player.seekTo((player.currentPosition - 10_000).coerceAtLeast(0))
                        true
                    }
                    Key.DirectionRight -> {
                        player.seekTo(player.currentPosition + 10_000)
                        true
                    }
                    Key.MediaPlayPause -> {
                        if (player.isPlaying) player.pause() else player.play()
                        true
                    }
                    Key.MediaFastForward -> {
                        player.seekTo(player.currentPosition + 10_000)
                        true
                    }
                    Key.MediaRewind -> {
                        player.seekTo((player.currentPosition - 10_000).coerceAtLeast(0))
                        true
                    }
                    else -> false
                }
            },
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    this.player = player
                    useController = true
                    controllerShowTimeoutMs = 4000
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/**
 * Origem do site oficial — o provedor só entrega o player com este Referer.
 *
 * Verificado em 2026-11-18 com curl: sem Referer, myembed.biz devolve 94.951
 * bytes do site de cloaking "Investidor.blog"; com Referer do MovieFlix,
 * devolve 3.746 bytes do player real. Era essa a página branca com texto.
 */
private const val SITE_ORIGIN = "https://movieflix.velixir.run/"

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun TvEmbedPlayer(url: String) {
    var webView by remember { mutableStateOf<WebView?>(null) }
    var failed by remember { mutableStateOf(false) }
    var ready by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        onDispose {
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
                            ready = true
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
                    webView = this
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        if (!ready && !failed) {
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
    }
}

/** Hosts do provedor que podem navegar dentro do WebView. */
private fun isProviderHost(host: String): Boolean =
    host.contains("myembed") ||
        host.contains("playerflix") ||
        host.contains("streambetter") ||
        host.contains("cloudflare") ||
        host.contains("challenges.")
