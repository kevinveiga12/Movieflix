package run.velixir.movieflix.shell

import android.app.Application
import android.webkit.WebView

/**
 * Application da casca.
 *
 * Duas coisas acontecem aqui, e as duas existem para o app não parecer um site:
 *
 *  1. `WebView.setWebContentsDebuggingEnabled(false)` em release — sem isso o
 *     WebView fica inspecionável e, mais importante, o comportamento de
 *     depuração pode expor o "chrome" do WebView.
 *  2. `WebView` é inicializado com o data directory padrão do app, o que faz os
 *     cookies e o localStorage do site viverem no armazenamento privado do
 *     aplicativo — é o que mantém o login entre execuções.
 */
class MovieFlixShellApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (!BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(false)
        }
    }
}
