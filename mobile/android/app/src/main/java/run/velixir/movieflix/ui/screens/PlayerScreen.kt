package run.velixir.movieflix.ui.screens

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import run.velixir.movieflix.AppViewModel
import run.velixir.movieflix.data.Title
import run.velixir.movieflix.ui.theme.MfColors

/**
 * Player do app mobile.
 *
 * Dois modos, decididos pelo SERVIDOR (campo `source.mode`):
 *
 *  - "direct" → MP4/HLS. Usa Media3/ExoPlayer: controles nativos, pausa,
 *    retomada, seek e retomada de posição. É o modo ideal.
 *  - "embed"  → página do provedor. Usa WebView com bloqueio de pop-up e de
 *    navegação externa: nada abre fora do app, nada sai do MovieFlix.
 *
 * A autorização vem sempre de /api/playback/authorize — o app nunca libera
 * conteúdo por conta própria.
 */
@Composable
fun PlayerScreen(
    vm: AppViewModel,
    title: Title,
    season: Int?,
    episode: Int?,
    onBack: () -> Unit,
) {
    val s by vm.state.collectAsState()
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
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        when {
            loading -> Text(
                "Carregando…",
                color = MfColors.TextMuted,
                modifier = Modifier.align(Alignment.Center),
            )

            message != null -> Column(
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    message!!,
                    color = MfColors.TextSoft,
                    fontSize = 15.sp,
                    lineHeight = 22.sp,
                )
                Spacer(Modifier.height(18.dp))
                Text(
                    "Voltar",
                    color = MfColors.Red,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(12.dp).then(
                        Modifier.clickableNoRipple(onBack),
                    ),
                )
            }

            url != null && mode == "direct" -> DirectPlayer(
                url = url!!,
                title = title,
                season = season,
                episode = episode,
                vm = vm,
            )

            url != null -> EmbedPlayer(url = url!!)
        }

        Text(
            "‹ Voltar",
            color = Color.White,
            fontSize = 14.sp,
            modifier = Modifier
                .padding(16.dp)
                .clickableNoRipple(onBack),
        )
    }
}

private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier =
    this.clickable(onClick = onClick)

/** MP4/HLS com controles nativos do Media3. */
@Composable
private fun DirectPlayer(
    url: String,
    title: Title,
    season: Int?,
    episode: Int?,
    vm: AppViewModel,
) {
    val context = LocalContext.current
    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
            playWhenReady = true
        }
    }

    DisposableEffect(Unit) {
        onDispose { player.release() }
    }

    // Salva a posição a cada 10s — é o que alimenta "continuar assistindo"
    // no celular, na TV e no site (mesma tabela watch_history).
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

    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                this.player = player
                useController = true
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            }
        },
        modifier = Modifier.fillMaxSize(),
    )
}

/**
 * Origem do site oficial.
 *
 * O provedor EmbedMovies só entrega o player quando recebe o Referer do site
 * que o incorporou. Verificado em 2026-11-18 com curl:
 *
 *   GET https://myembed.biz/filme/1292035            → 94.951 bytes, HTML do
 *                                                      "Investidor.blog"
 *   GET ... com Referer: https://movieflix.velixir.run/ → 3.746 bytes, o
 *                                                      player de verdade
 *
 * Era exatamente isso a "página branca com um monte de texto": o WebView
 * carregava a URL sem Referer, o provedor devolvia o site de cloaking e o app
 * renderizava aquilo cru. O site não sofre disso porque o <iframe> usa
 * referrerPolicy="origin".
 */
private const val SITE_ORIGIN = "https://movieflix.velixir.run/"

/**
 * Página do provedor em WebView, com o mesmo princípio do sandbox do site:
 * o conteúdo roda, mas não abre janela, não navega para fora e não dispara
 * intent externo.
 *
 * O Referer é enviado explicitamente — sem ele o provedor devolve a página de
 * cloaking (ver SITE_ORIGIN). Se a página falhar de verdade, mostramos uma
 * mensagem curta em português em vez de deixar a tela em branco.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun EmbedPlayer(url: String) {
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

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        mediaPlaybackRequiresUserGesture = false
                        // Bloqueio de pop-up: nenhuma janela nova é criada.
                        javaScriptCanOpenWindowsAutomatically = false
                        setSupportMultipleWindows(false)
                        allowFileAccess = false
                        allowContentAccess = false
                        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        userAgentString = "$userAgentString MovieFlixApp/1.0"
                    }

                    webChromeClient = object : WebChromeClient() {
                        // Sem onCreateWindow: qualquer window.open() é descartado.
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
                            // Só o próprio provedor navega dentro do WebView.
                            // Qualquer outro destino é bloqueado — nada abre fora.
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
                            // Só a navegação principal interessa: erro em um
                            // recurso secundário não derruba o player.
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
                fontSize = 14.sp,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        if (failed) {
            Column(
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "Não foi possível abrir o player agora.",
                    color = MfColors.TextSoft,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Verifique sua conexão e tente novamente em instantes.",
                    color = MfColors.TextMuted,
                    fontSize = 13.sp,
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
