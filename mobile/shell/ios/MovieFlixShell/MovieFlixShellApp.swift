import SwiftUI
import WebKit

/// MovieFlix — casca iOS.
///
/// Mesma ideia da casca Android: o app não reimplementa o MovieFlix, ele carrega
/// o site publicado em um `WKWebView` em tela cheia. Assim qualquer mudança no
/// site aparece no app na próxima abertura, sem gerar versão nova.
///
/// O que faz parecer um aplicativo de verdade:
///  - sem barra de endereço, sem botões de Safari, sem "Abrir no Safari";
///  - `WKWebView` com `allowsLinkPreview = false` (sem menu de contexto);
///  - splash nativo enquanto a primeira página carrega;
///  - tela de erro própria quando não há internet;
///  - cookies e `localStorage` persistidos: o login continua entre execuções;
///  - links externos abrem no app correspondente, nunca numa segunda janela.
@main
struct MovieFlixShellApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
                .ignoresSafeArea(.all)
        }
    }
}

struct RootView: View {
    @StateObject private var model = WebModel()

    var body: some View {
        ZStack {
            Color(red: 0.039, green: 0.039, blue: 0.059).ignoresSafeArea()

            WebView(model: model)
                .ignoresSafeArea(.all)
                .opacity(model.failed ? 0 : 1)

            if model.loading {
                SplashView()
            }

            if model.failed {
                OfflineView { model.reload() }
            }
        }
        .statusBarHidden(false)
    }
}

// MARK: - Modelo

final class WebModel: ObservableObject {
    /// Endereço público do MovieFlix. Trocar aqui aponta o app para outro host.
    static let siteURL = URL(string: "https://movieflix.velixir.run")!

    @Published var loading = true
    @Published var failed = false

    /// Só a primeira carga leva `?app=ios`; as seguintes já têm a marca.
    private var firstLoad = true

    func startURL() -> URL {
        if firstLoad {
            firstLoad = false
            var c = URLComponents(url: Self.siteURL, resolvingAgainstBaseURL: false)
            c?.queryItems = [URLQueryItem(name: "app", value: "ios")]
            return c?.url ?? Self.siteURL
        }
        return Self.siteURL
    }

    func reload() {
        failed = false
        loading = true
        NotificationCenter.default.post(name: .mfReload, object: nil)
    }
}

extension Notification.Name {
    static let mfReload = Notification.Name("mf.reload")
}

// MARK: - WKWebView

struct WebView: UIViewRepresentable {
    @ObservedObject var model: WebModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default() // cookies persistentes = login mantido

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.allowsLinkPreview = false
        web.scrollView.bounces = false
        web.scrollView.showsVerticalScrollIndicator = false
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.039, green: 0.039, blue: 0.059, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor

        // O site detecta o app por esta marca (ver src/lib/appEnv.ts).
        web.customUserAgent = (web.value(forKey: "userAgent") as? String ?? "")
            + " MovieFlixApp/1.0"

        context.coordinator.web = web
        web.load(URLRequest(url: model.startURL()))

        NotificationCenter.default.addObserver(
            forName: .mfReload, object: nil, queue: .main
        ) { [weak web] _ in
            web?.load(URLRequest(url: WebModel.siteURL))
        }

        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let model: WebModel
        weak var web: WKWebView?

        init(model: WebModel) { self.model = model }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation: WKNavigation!) {
            model.failed = false
            model.loading = true
        }

        func webView(_ webView: WKWebView, didFinish: WKNavigation!) {
            model.loading = false
            // Esconde a barra de rolagem: último detalhe que denuncia "página".
            webView.evaluateJavaScript(
                "(function(){var s=document.createElement('style');" +
                "s.textContent='::-webkit-scrollbar{display:none}';" +
                "document.head&&document.head.appendChild(s);})()",
                completionHandler: nil
            )
        }

        func webView(_ webView: WKWebView, didFail: WKNavigation!, withError: Error) {
            model.loading = false
            model.failed = true
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation: WKNavigation!, withError: Error) {
            model.loading = false
            model.failed = true
        }

        /// Links externos saem do app; o domínio do site fica dentro.
        func webView(
            _ webView: WKWebView,
            decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = action.request.url else {
                decisionHandler(.allow); return
            }
            let siteHost = WebModel.siteURL.host
            if url.host == siteHost { decisionHandler(.allow); return }

            if ["http", "https", "mailto", "tel", "whatsapp"].contains(url.scheme ?? "") {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        /// Sem `target="_blank"` abrindo janela: carrega na mesma tela.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
                webView.load(URLRequest(url: url))
            }
            return nil
        }
    }
}

// MARK: - Telas nativas

struct SplashView: View {
    var body: some View {
        ZStack {
            Color(red: 0.039, green: 0.039, blue: 0.059).ignoresSafeArea()
            VStack(spacing: 18) {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 120, height: 120)
                ProgressView().tint(.white)
            }
        }
    }
}

struct OfflineView: View {
    let retry: () -> Void

    var body: some View {
        ZStack {
            Color(red: 0.039, green: 0.039, blue: 0.059).ignoresSafeArea()
            VStack(spacing: 14) {
                Image("Logo").resizable().scaledToFit().frame(width: 96, height: 96)
                Text("Sem conexão")
                    .font(.title3.bold())
                    .foregroundColor(.white)
                Text("Verifique sua internet e tente de novo.")
                    .font(.subheadline)
                    .foregroundColor(.gray)
                Button(action: retry) {
                    Text("Tentar novamente")
                        .font(.headline)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 12)
                        .background(Color(red: 0.898, green: 0.035, blue: 0.078))
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                }
                .padding(.top, 8)
            }
            .padding(32)
        }
    }
}
