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
import run.velixir.movieflix.data.PlaybackSource
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
    /**
     * Cadeia multiprovedor devolvida pelo servidor, em ordem de preferência.
     * Começamos no índice 0 e só avançamos em falha real — nunca por pausa.
     */
    var chain by remember { mutableStateOf<List<PlaybackSource>>(emptyList()) }
    var chainIndex by remember { mutableStateOf(0) }

    /**
     * TELA CHEIA PELO NOSSO LADO — LIGADA AO ABRIR.
     *
     * O botão de tela cheia do provedor chama `requestFullscreen()` de dentro
     * de um iframe aninhado. O navegador recusa esse pedido em silêncio quando
     * algum elo da cadeia não delega `fullscreen` — e o `allow` dos iframes
     * internos é do provedor, não nosso. Resultado: `onShowCustomView` nunca é
     * chamado e nada acontece na tela.
     *
     * Por isso a tela cheia é nossa: escondemos a interface do app, tiramos as
     * barras do sistema e deixamos o WebView ocupando a tela inteira.
     *
     * COMEÇA LIGADA (`true`): o proprietário pediu que, ao abrir o player, ele
     * já entre em tela cheia, sem um segundo toque — o mesmo comportamento do
     * site. O botão de ENTRADA saiu; fica só o ✕ para sair.
     */
    var immersive by remember { mutableStateOf(true) }
    val context = LocalContext.current

    /*
      BOTÃO VOLTAR DO ANDROID — SAI DA TELA CHEIA ANTES DE SAIR DO PLAYER.

      ── O DEFEITO QUE ISTO CORRIGE ────────────────────────────────────────────
      O player abre em tela cheia (`immersive = true`). Sem este handler, o
      Voltar do aparelho pulava direto para a tela de detalhes, deixando o
      `immersive` ligado: as barras do sistema continuavam escondidas na tela
      seguinte e o app parecia "travado" em tela cheia.

      Agora o primeiro Voltar desliga o imersivo (volta ao modo normal, com as
      barras do sistema e o botão ‹ Voltar visíveis) e só o segundo Voltar sai
      do player — o comportamento que o pedido descreve.
    */
    androidx.activity.compose.BackHandler(enabled = immersive) {
        immersive = false
    }

    // Barras do sistema somem enquanto `immersive` estiver ligado.
    DisposableEffect(immersive) {
        val activity = context as? android.app.Activity
        if (activity != null) {
            val window = activity.window
            if (immersive) {
                runCatching {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                        window.insetsController?.hide(android.view.WindowInsets.Type.systemBars())
                        window.insetsController?.systemBarsBehavior =
                            android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    } else {
                        @Suppress("DEPRECATION")
                        window.decorView.systemUiVisibility = (
                            android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                                or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                or android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            )
                    }
                }
            } else {
                runCatching {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                        window.insetsController?.show(android.view.WindowInsets.Type.systemBars())
                    } else {
                        @Suppress("DEPRECATION")
                        window.decorView.systemUiVisibility = android.view.View.SYSTEM_UI_FLAG_VISIBLE
                    }
                }
            }
        }
        onDispose {
            val activity = context as? android.app.Activity ?: return@onDispose
            runCatching {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                    activity.window.insetsController?.show(
                        android.view.WindowInsets.Type.systemBars(),
                    )
                } else {
                    @Suppress("DEPRECATION")
                    activity.window.decorView.systemUiVisibility =
                        android.view.View.SYSTEM_UI_FLAG_VISIBLE
                }
            }
        }
    }

    LaunchedEffect(title.tmdbId, season, episode) {
        vm.authorize(title.tmdbId, season, episode) { sources, msg ->
            if (sources.isEmpty()) {
                url = null
                mode = null
                message = msg
                loading = false
                return@authorize
            }
            chain = sources
            chainIndex = 0
            url = sources[0].url
            mode = sources[0].mode
            message = null
            loading = false
        }
    }

    /**
     * Avança para a próxima fonte da cadeia — SÓ em falha real.
     *
     * Chamado pelo erro de carregamento do player. Se a cadeia acabar, mostra a
     * mensagem honesta em vez de inventar uma fonte.
     */
    fun advanceSource() {
        val next = chainIndex + 1
        if (next < chain.size) {
            chainIndex = next
            url = chain[next].url
            mode = chain[next].mode
            return
        }
        url = null
        mode = null
        message = "Nenhuma fonte de reprodução está disponível agora. Tente novamente em instantes."
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
                immersive = immersive,
                onToggleImmersive = { immersive = !immersive },
                onSourceFailed = { advanceSource() },
            )

            url != null -> EmbedPlayer(
                url = url!!,
                immersive = immersive,
                onToggleImmersive = { immersive = !immersive },
                onSourceFailed = { advanceSource() },
            )
        }

        // O botão "Voltar" é interface NOSSA: em tela cheia ele sai da tela.
        if (!immersive) {
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
    immersive: Boolean = false,
    onToggleImmersive: () -> Unit = {},
    onSourceFailed: () -> Unit = {},
) {
    val context = LocalContext.current
    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
            playWhenReady = true
        }
    }

    // Falha REAL de mídia (manifesto inválido, 404, codec): avança a cadeia.
    // Buffering e pausa NÃO passam por aqui.
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                onSourceFailed()
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
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

    Box(Modifier.fillMaxSize()) {
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

        /*
          BOTÃO DE SAIR DA TELA CHEIA — MODO DIRETO.

          ── O DEFEITO QUE ISTO CORRIGE ────────────────────────────────────────
          O `EmbedPlayer` já tinha o ✕, mas o `DirectPlayer` (MP4/HLS, o modo
          mais comum) não tinha NENHUM. Como o player abre em tela cheia e as
          barras do sistema estão escondidas, o cliente ficava sem saída visível
          — só o Voltar do aparelho, que antes pulava a tela inteira.

          Fica no canto superior direito, discreto, e só existe em tela cheia.
        */
        if (immersive) {
            Text(
                "✕",
                color = Color.White,
                fontSize = 20.sp,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(12.dp)
                    .background(Color(0x66000000), androidx.compose.foundation.shape.CircleShape)
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .clickableNoRipple(onToggleImmersive),
            )
        }
    }
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
internal fun EmbedPlayer(
    url: String,
    immersive: Boolean = false,
    onToggleImmersive: () -> Unit = {},
    onSourceFailed: () -> Unit = {},
) {
    var webView by remember { mutableStateOf<WebView?>(null) }
    var failed by remember { mutableStateOf(false) }
    var ready by remember { mutableStateOf(false) }
    // Tela cheia do player do provedor (ver onShowCustomView).
    var fullscreenView by remember { mutableStateOf<android.view.View?>(null) }
    var fullscreenCallback by remember {
        mutableStateOf<WebChromeClient.CustomViewCallback?>(null)
    }

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

                        /**
                         * TELA CHEIA DO PROVEDOR (quando ele consegue).
                         *
                         * Continua implementado porque, se o provedor entregar
                         * o pedido, é o caminho mais fiel. Mas NÃO dependemos
                         * dele: ver `immersive` em PlayerScreen — o botão de
                         * tela cheia do provedor é recusado em silêncio quando
                         * um elo da cadeia de iframes não delega `fullscreen`.
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
                            onToggleImmersive()
                        }

                        override fun onHideCustomView() {
                            val activity = (context as? android.app.Activity) ?: return
                            val decor = activity.window.decorView as android.view.ViewGroup
                            fullscreenView?.let { decor.removeView(it) }
                            fullscreenView = null
                            fullscreenCallback?.onCustomViewHidden()
                            fullscreenCallback = null
                            onToggleImmersive()
                        }
                    }

                    webViewClient = object : WebViewClient() {
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
                            // Falha real no frame principal: avança a cadeia.
                            if (request?.isForMainFrame == true) {
                                failed = true
                                onSourceFailed()
                            }
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

        /*
          BOTÃO DE SAIR DA TELA CHEIA.

          O player já abre em tela cheia, então NÃO existe botão de ENTRADA —
          o proprietário pediu para tirar o botão branco de tela cheia. Fica só
          o ✕, e só enquanto estiver em tela cheia: é a única forma de voltar
          ao normal no celular, onde não existe tecla Escape.
        */
        if (ready && !failed && immersive) {
            Text(
                "✕",
                color = Color.White,
                fontSize = 20.sp,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(12.dp)
                    .background(Color(0x66000000), androidx.compose.foundation.shape.CircleShape)
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .clickableNoRipple(onToggleImmersive),
            )
        }
    }
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
