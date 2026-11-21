package run.velixir.movieflix.shell

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * A única tela do aplicativo: o MovieFlix em tela cheia.
 *
 * ── POR QUE UM WEBVIEW E NÃO UMA UI NATIVA ─────────────────────────────────
 *
 * O pedido é explícito: "tudo o que eu mudar no site tem que mudar
 * automaticamente no aplicativo, sem precisar gerar um app novo". Uma UI nativa
 * (como a versão anterior em Compose) obriga a recompilar e redistribuir o APK
 * a cada mudança. Carregando o site publicado, o app é sempre o site de agora.
 *
 * ── POR QUE NÃO PARECE UM SITE ─────────────────────────────────────────────
 *
 *  - `setSupportZoom(false)`, sem barra de endereço, sem botões de navegador:
 *    o WebView é só uma superfície de conteúdo.
 *  - `isLongClickable = false` e `setOnLongClickListener { true }`: sem menu
 *    "Abrir no Chrome / Copiar link da imagem".
 *  - `shouldOverrideUrlLoading` manda qualquer domínio externo para o app
 *    correspondente (WhatsApp, e-mail) ou para o navegador do sistema — nunca
 *    abre uma segunda janela dentro do app.
 *  - O site recebe `?app=android` e o User-Agent `MovieFlixApp/1.0`, então ele
 *    esconde navbar/rodapé e aplica o layout de aplicativo (ver
 *    src/lib/appEnv.ts e o bloco "MODO APLICATIVO" em global.css).
 *  - Splash nativo + tela de erro própria: nenhuma tela do Chrome aparece.
 *  - Voltar navega no histórico do app; só sai quando não há mais para onde ir.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var progress: ProgressBar
    private lateinit var errorView: View

    /**
     * Estado da tela cheia do vídeo (ver `onShowCustomView`).
     *
     * `fullscreenView` é a view que o player entregou; `fullscreenContainer` é
     * o FrameLayout preto que a cobre a janela inteira; `fullscreenCallback`
     * é o retorno que o WebView espera para saber que a tela cheia acabou.
     */
    private var fullscreenView: View? = null
    private var fullscreenContainer: FrameLayout? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null

    /** Só a primeira carga leva `?app=android`; as seguintes já têm a marca. */
    private var firstLoad = true

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        // Conteúdo desenha atrás das barras do sistema; o site trata as safe
        // areas. Dá a sensação de app de tela cheia, não de página.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        progress = findViewById(R.id.progress)
        errorView = findViewById(R.id.error)

        findViewById<View>(R.id.retry).setOnClickListener {
            errorView.visibility = View.GONE
            web.visibility = View.VISIBLE
            loadHome()
        }

        configureWebView()
        configureBack()
        loadHome()
    }

    private fun configureWebView() {
        // Cookies persistentes: é o que mantém a sessão do Supabase entre
        // aberturas do app. Sem isto o usuário teria de entrar toda vez.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            // O site detecta o app por esta marca (ver src/lib/appEnv.ts).
            userAgentString = "$userAgentString MovieFlixApp/1.0"
        }

        // Sem menu de contexto: nada de "abrir no navegador".
        web.isLongClickable = false
        web.setOnLongClickListener { true }
        web.isHapticFeedbackEnabled = false
        web.overScrollMode = View.OVER_SCROLL_NEVER

        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }

            /**
             * ── TELA CHEIA DO VÍDEO ──────────────────────────────────────────
             *
             * O player do site chama `requestFullscreen()` no contêiner dele.
             * Dentro de um WebView isso NÃO vira tela cheia sozinho: o Android
             * entrega o pedido aqui, em `onShowCustomView`. Sem estes dois
             * métodos o WebView simplesmente ignora a chamada — era por isso
             * que, no app, o botão de tela cheia "enchia a tela mas não entrava
             * no filme": o site mudava o layout, mas o vídeo continuava do
             * tamanho do WebView, com a barra do app em volta.
             *
             * Aqui o `view` que o player entrega é colocado por cima de TUDO,
             * em um FrameLayout que cobre a janela inteira, e as barras do
             * sistema são escondidas. Ao sair, tudo volta ao lugar.
             */
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (view == null) return
                if (fullscreenView != null) {
                    // Já estamos em tela cheia: devolve o pedido anterior.
                    callback?.onCustomViewHidden()
                    return
                }
                fullscreenView = view
                fullscreenCallback = callback

                val container = FrameLayout(this@MainActivity).apply {
                    setBackgroundColor(android.graphics.Color.BLACK)
                    addView(
                        view,
                        FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.MATCH_PARENT,
                        ),
                    )
                }
                fullscreenContainer = container
                addContentView(
                    container,
                    android.view.ViewGroup.LayoutParams(
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    ),
                )

                // Esconde barras do sistema e mantém a tela acesa.
                WindowInsetsControllerCompat(window, window.decorView).apply {
                    hide(WindowInsetsCompat.Type.systemBars())
                    systemBarsBehavior =
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                }
                window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }

            override fun onHideCustomView() {
                exitFullscreen()
            }
        }

        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                errorView.visibility = View.GONE
                web.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progress.visibility = View.GONE
                // Esconde a barra de rolagem do WebView: é o último detalhe que
                // denuncia "página web".
                view?.evaluateJavascript(
                    "(function(){var s=document.createElement('style');" +
                        "s.textContent='::-webkit-scrollbar{width:0;height:0}';" +
                        "document.head&&document.head.appendChild(s);})()",
                    null,
                )
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val url = request?.url ?: return false
                return handleUrl(url)
            }

            @Deprecated("Compatibilidade com Android antigo")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                val uri = url?.let { Uri.parse(it) } ?: return false
                return handleUrl(uri)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                // Só a navegação principal troca a tela; um pôster que falhou
                // não pode derrubar o app inteiro.
                if (request?.isForMainFrame == true) {
                    web.visibility = View.GONE
                    errorView.visibility = View.VISIBLE
                }
            }
        }
    }

    /**
     * Decide o destino de um link.
     *
     *  - Mesmo domínio do site → carrega dentro do app (é navegação normal).
     *  - `whatsapp:`, `mailto:`, `tel:`, `intent:` → abre o app do sistema.
     *  - Qualquer outro site → abre no navegador do sistema, fora do app.
     *
     * Devolver `true` significa "eu tratei"; o WebView não navega.
     */
    private fun handleUrl(uri: Uri): Boolean {
        val siteHost = Uri.parse(BuildConfig.SITE_URL).host ?: return false
        val scheme = uri.scheme?.lowercase() ?: return false

        if (scheme == "http" || scheme == "https") {
            if (uri.host == siteHost) return false // navegação interna
            openExternally(uri)
            return true
        }

        if (scheme in setOf("whatsapp", "mailto", "tel", "sms", "intent", "market")) {
            openExternally(uri)
            return true
        }

        return false
    }

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            // Sem app para tratar o link: não faz nada em vez de abrir o
            // navegador numa tela que parece site.
        }
    }

    private fun loadHome() {
        val base = BuildConfig.SITE_URL.trimEnd('/')
        val url = if (firstLoad) "$base/?app=android" else base
        firstLoad = false
        web.loadUrl(url)
    }

    private fun configureBack() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    /**
                     * Voltar em tela cheia SAI da tela cheia, não do player.
                     *
                     * É o comportamento que o cliente espera: o primeiro
                     * "voltar" devolve o vídeo ao tamanho normal; só o segundo
                     * sai do filme. Sem esta checagem, o botão voltar fecharia
                     * o player inteiro com o vídeo ainda em tela cheia.
                     */
                    if (fullscreenView != null) {
                        exitFullscreen()
                        return
                    }
                    if (web.canGoBack()) {
                        web.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            },
        )
    }

    /**
     * Desmonta a tela cheia do vídeo e devolve o controle ao WebView.
     *
     * Ordem importa: remove a view da janela, avisa o WebView pelo callback
     * (senão ele fica achando que a tela cheia continua ativa e ignora o
     * próximo pedido), restaura as barras do sistema e libera a tela acesa.
     */
    private fun exitFullscreen() {
        val container = fullscreenContainer ?: return
        val callback = fullscreenCallback

        fullscreenView = null
        fullscreenContainer = null
        fullscreenCallback = null

        (container.parent as? android.view.ViewGroup)?.removeView(container)

        WindowInsetsControllerCompat(window, window.decorView).apply {
            show(WindowInsetsCompat.Type.systemBars())
        }
        window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        callback?.onCustomViewHidden()
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        CookieManager.getInstance().flush()
        web.destroy()
        super.onDestroy()
    }
}
