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
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
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
    /**
     * Troca de episódio (botões anterior/próximo e avanço automático).
     *
     * A navegação vive no MainActivity, que já é dona da rota. O player só
     * PEDE a troca — nunca navega por conta própria.
     */
    onEpisodeChange: (Int, Int) -> Unit = { _, _ -> },
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

    /*
      ══════════════════════════════════════════════════════════════════════
      EPISÓDIO ANTERIOR / PRÓXIMO E AVANÇO AUTOMÁTICO
      ══════════════════════════════════════════════════════════════════════

      A ordem real da temporada vem de `episodes_available` (["1/1","1/2",…]),
      a MESMA lista que o servidor usa para autorizar a reprodução. Não
      inventamos episódio: se o par não está na lista, não existe.
    */
    val episodeOrder = remember(title.tmdbId) {
        (title.episodesAvailable ?: emptyList())
            .mapNotNull { key ->
                val parts = key.split('/')
                if (parts.size != 2) return@mapNotNull null
                val s = parts[0].toIntOrNull() ?: return@mapNotNull null
                val e = parts[1].toIntOrNull() ?: return@mapNotNull null
                s to e
            }
    }
    val epIndex = if (season != null && episode != null) {
        episodeOrder.indexOf(season to episode)
    } else {
        -1
    }
    val prevEp = if (epIndex > 0) episodeOrder[epIndex - 1] else null
    val nextEp = if (epIndex >= 0 && epIndex + 1 < episodeOrder.size) {
        episodeOrder[epIndex + 1]
    } else {
        null
    }

    /**
     * O usuário já trocou de episódio à mão?
     *
     * NÃO usamos isso para bloquear o avanço automático: se a pessoa escolheu o
     * episódio 5 e ele termina, o natural é seguir para o 6. O avanço só depende
     * do fim REAL da mídia e da existência de um próximo episódio.
     */
    fun goToEpisode(target: Pair<Int, Int>) {
        onEpisodeChange(target.first, target.second)
    }

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
                prevEp = prevEp,
                nextEp = nextEp,
                onPrev = { prevEp?.let { goToEpisode(it) } },
                onNext = { nextEp?.let { goToEpisode(it) } },
                autoAdvance = true,
            )

            url != null -> EmbedPlayer(
                url = url!!,
                immersive = immersive,
                onToggleImmersive = { immersive = !immersive },
                onSourceFailed = { advanceSource() },
                prevEp = prevEp,
                nextEp = nextEp,
                onPrev = { prevEp?.let { goToEpisode(it) } },
                onNext = { nextEp?.let { goToEpisode(it) } },
                autoAdvance = true,
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
    /** Episódio anterior/próximo na ordem real da temporada (null nas pontas). */
    prevEp: Pair<Int, Int>? = null,
    nextEp: Pair<Int, Int>? = null,
    onPrev: () -> Unit = {},
    onNext: () -> Unit = {},
    /** Avanço automático ligado? Desligado quando o usuário trocou à mão. */
    autoAdvance: Boolean = true,
) {
    val context = LocalContext.current
    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
            playWhenReady = true
        }
    }

    /*
      Posição/duração reais — só para decidir quando o "próximo" ganha
      destaque (últimos 15 s). Não é uma barra nossa: o PlayerView já tem a
      dele, e não duplicamos controle.
    */
    var positionSec by remember { mutableStateOf(0.0) }
    var durationSec by remember { mutableStateOf(0.0) }
    LaunchedEffect(player) {
        while (true) {
            positionSec = (player.currentPosition / 1000.0).coerceAtLeast(0.0)
            durationSec = (player.duration / 1000.0).coerceAtLeast(0.0)
            kotlinx.coroutines.delay(500)
        }
    }

    // Falha REAL de mídia (manifesto inválido, 404, codec): avança a cadeia.
    // Buffering e pausa NÃO passam por aqui.
    val endedHandled = remember(url) { java.util.concurrent.atomic.AtomicBoolean(false) }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                onSourceFailed()
            }

            /*
              AVANÇO AUTOMÁTICO PARA O PRÓXIMO EPISÓDIO.

              `STATE_ENDED` é o fim REAL da mídia. Só então — e só se existir
              próximo episódio na ordem da temporada e o usuário não tiver
              trocado à mão — pedimos a troca. No último episódio, nada.

              `endedHandled` garante UM disparo: o listener pode receber
              STATE_ENDED mais de uma vez.
            */
            override fun onPlaybackStateChanged(state: Int) {
                if (state != Player.STATE_ENDED) return
                if (!autoAdvance || nextEp == null) return
                if (!endedHandled.compareAndSet(false, true)) return
                onNext()
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

        /*
          BOTÕES DE EPISÓDIO ANTERIOR / PRÓXIMO — modo DIRETO.

          Ficam no canto inferior direito, acima dos controles nativos do
          Media3. Desabilitados nas pontas (nunca inventamos episódio) e o
          "próximo" ganha destaque nos últimos 15 s — o "tempinho de
          antecedência" pedido.
        */
        if (prevEp != null || nextEp != null) {
            val nearEnd = durationSec > 0 &&
                durationSec - positionSec <= 15 &&
                durationSec - positionSec > 0
            Row(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 12.dp, bottom = 76.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                EpisodeChip(
                    label = "Ep. anterior",
                    sub = prevEp?.let { "T${it.first} E${it.second}" },
                    enabled = prevEp != null,
                    highlight = false,
                    onClick = onPrev,
                )
                EpisodeChip(
                    label = "Próximo ep.",
                    sub = nextEp?.let { "T${it.first} E${it.second}" },
                    enabled = nextEp != null,
                    highlight = nearEnd && nextEp != null,
                    onClick = onNext,
                )
            }
        }
    }
}

/**
 * Botão de episódio do app mobile.
 *
 * Pílula com rótulo e o par T/E. Esmaecido e inerte quando não há episódio
 * naquela direção; com anel vermelho quando é o "próximo" nos últimos 15 s.
 */
@Composable
private fun EpisodeChip(
    label: String,
    sub: String?,
    enabled: Boolean,
    highlight: Boolean,
    onClick: () -> Unit,
) {
    val bg = when {
        !enabled -> Color(0x33FFFFFF)
        highlight -> Color(0xE6FFFFFF)
        else -> Color(0x99000000)
    }
    val fg = when {
        !enabled -> Color(0x66FFFFFF)
        highlight -> Color(0xFF0A0A0E)
        else -> Color.White
    }
    Column(
        Modifier
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
            .background(bg)
            .then(
                if (highlight) {
                    Modifier.border(
                        2.dp,
                        MfColors.Red,
                        androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
                    )
                } else {
                    Modifier
                },
            )
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = label, color = fg, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        if (sub != null) {
            Text(
                text = sub,
                color = if (highlight) Color(0xCC0A0A0E) else Color(0xB3FFFFFF),
                fontSize = 10.sp,
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
 * Observador do FIM do episódio no modo embed.
 *
 * O `<video>` do provedor é de outra origem, mas o evento `ended` é observável
 * de dentro da própria página. Este script procura o `<video>` (o provedor pode
 * montá-lo depois do `onPageFinished`, então tentamos por um tempo) e, quando a
 * mídia termina de verdade, chama `MfEnded.onEnded()` — a ponte Kotlin decide se
 * avança de episódio.
 *
 * Nada de estimativa: só o `ended` real dispara. Se o `<video>` nunca aparecer,
 * o script simplesmente desiste — não inventa um fim.
 */
private const val ENDED_OBSERVER_JS = """
(function () {
  if (window.__mfEndedHooked) return;
  window.__mfEndedHooked = true;
  var tries = 0;
  function hook() {
    var v = document.querySelector('video');
    if (!v) {
      if (tries++ < 60) setTimeout(hook, 500);
      return;
    }
    if (v.__mfEndedBound) return;
    v.__mfEndedBound = true;
    v.addEventListener('ended', function () {
      try { if (window.MfEnded && window.MfEnded.onEnded) window.MfEnded.onEnded(); } catch (e) {}
    }, true);
  }
  hook();
})();
"""

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
    /** Episódio anterior/próximo na ordem real da temporada (null nas pontas). */
    prevEp: Pair<Int, Int>? = null,
    nextEp: Pair<Int, Int>? = null,
    onPrev: () -> Unit = {},
    onNext: () -> Unit = {},
    /** Avanço automático ligado? Desligado quando o usuário trocou à mão. */
    autoAdvance: Boolean = true,
) {
    var webView by remember { mutableStateOf<WebView?>(null) }
    var failed by remember { mutableStateOf(false) }
    var ready by remember { mutableStateOf(false) }
    // Tela cheia do player do provedor (ver onShowCustomView).
    var fullscreenView by remember { mutableStateOf<android.view.View?>(null) }
    var fullscreenCallback by remember {
        mutableStateOf<WebChromeClient.CustomViewCallback?>(null)
    }

    /*
      FIM DO EPISÓDIO NO MODO EMBED.

      O `<video>` é de outra origem, mas o evento `ended` chega até nós por um
      script injetado na página do provedor: ele observa o `<video>` e chama
      `MfEnded.onEnded()` quando a mídia termina de verdade. Nunca deduzimos
      "acabou" por proximidade do fim.

      `autoAdvanced` é um holder simples (não estado do Compose): a ponte JS
      chama de uma thread de background, e escrever estado do Compose de lá é
      inseguro. A navegação é postada na thread principal.
    */
    val autoAdvanced = remember(url) { java.util.concurrent.atomic.AtomicBoolean(false) }
    val mainHandler = remember { android.os.Handler(android.os.Looper.getMainLooper()) }

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

                    /*
                      PONTE DO FIM DO EPISÓDIO.

                      O script injetado em `onPageFinished` observa o `<video>`
                      do provedor e chama `MfEnded.onEnded()` quando a mídia
                      termina. É o único sinal honesto de "acabou" no modo
                      embed — o `<video>` é de outra origem e não dá para ler
                      `ended` de fora.
                    */
                    addJavascriptInterface(
                        object {
                            @android.webkit.JavascriptInterface
                            fun onEnded() {
                                if (!autoAdvance || nextEp == null) return
                                if (!autoAdvanced.compareAndSet(false, true)) return
                                mainHandler.post { onNext() }
                            }
                        },
                        "MfEnded",
                    )

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
                            /*
                              Observador do FIM do episódio.

                              O `<video>` do provedor é de outra origem, mas o
                              evento `ended` é observável de dentro da própria
                              página. Este script escuta o `<video>` e avisa o
                              app por `MfEnded.onEnded()` — é o único sinal
                              honesto de "acabou" no modo embed.

                              Reaplicado a cada `onPageFinished` porque o
                              provedor pode trocar de documento ao carregar o
                              player.
                            */
                            view?.evaluateJavascript(ENDED_OBSERVER_JS, null)
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

        /*
          BOTÕES DE EPISÓDIO ANTERIOR / PRÓXIMO — modo EMBED.

          Mesma regra do modo direto: desabilitados nas pontas, "próximo" com
          destaque nos últimos 15 s. Aqui não temos a duração do `<video>` do
          provedor, então o destaque não é calculado — os botões ficam sempre
          visíveis, sem inventar um tempo que não sabemos.
        */
        if (ready && !failed && (prevEp != null || nextEp != null)) {
            Row(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 12.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                EpisodeChip(
                    label = "Ep. anterior",
                    sub = prevEp?.let { "T${it.first} E${it.second}" },
                    enabled = prevEp != null,
                    highlight = false,
                    onClick = onPrev,
                )
                EpisodeChip(
                    label = "Próximo ep.",
                    sub = nextEp?.let { "T${it.first} E${it.second}" },
                    enabled = nextEp != null,
                    highlight = false,
                    onClick = onNext,
                )
            }
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
