import SwiftUI
import AVKit
import WebKit

// MARK: - Detalhe

struct DetailView: View {
    @EnvironmentObject var app: AppState
    let title: Title

    @State private var selectedSeason = 1
    @State private var playerTarget: PlayerTarget?

    struct PlayerTarget: Identifiable {
        let id = UUID()
        let season: Int?
        let episode: Int?
    }

    private var currentSeason: Season? {
        app.seasons.first { $0.seasonNumber == selectedSeason }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .bottomLeading) {
                    AsyncImage(url: URL(string: title.backdropUrl.isEmpty ? title.posterUrl : title.backdropUrl)) { phase in
                        switch phase {
                        case .success(let img): img.resizable().scaledToFill()
                        default: MF.bgCard
                        }
                    }
                    .frame(height: 240)
                    .clipped()

                    LinearGradient(
                        colors: [.clear, MF.bg.opacity(0.8), MF.bg],
                        startPoint: .top, endPoint: .bottom
                    )
                }
                .frame(height: 240)

                VStack(alignment: .leading, spacing: 10) {
                    Text(title.title)
                        .font(.system(size: 24, weight: .black))
                        .foregroundStyle(MF.text)

                    HStack(spacing: 10) {
                        Text("★ \(title.ratingLabel)").foregroundStyle(MF.warning)
                        Text(title.year).foregroundStyle(MF.textMuted)
                        Text(title.quality).foregroundStyle(MF.textMuted)
                        if let d = title.duration {
                            Text("\(d) min").foregroundStyle(MF.textMuted)
                        }
                    }
                    .font(.system(size: 12))

                    HStack(spacing: 10) {
                        Button {
                            if title.isSeries {
                                let parts = title.episodesAvailable?.first?
                                    .split(separator: "/").compactMap { Int($0) } ?? []
                                playerTarget = PlayerTarget(
                                    season: parts.first ?? 1,
                                    episode: parts.count > 1 ? parts[1] : 1
                                )
                            } else {
                                playerTarget = PlayerTarget(season: nil, episode: nil)
                            }
                        } label: {
                            Text("▶  Assistir")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 26)
                                .padding(.vertical, 11)
                                .background(MF.red)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }

                        Button {
                            Task { await app.toggleFavorite(title) }
                        } label: {
                            Text(app.isFavorite(title.tmdbId) ? "♥ Favorito" : "♡ Favoritar")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(MF.textSoft)
                                .padding(.horizontal, 18)
                                .padding(.vertical, 11)
                                .background(MF.bgCard)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                    .padding(.top, 4)

                    if !title.description.isEmpty {
                        Text(title.description)
                            .font(.system(size: 13))
                            .foregroundStyle(MF.textMuted)
                            .lineSpacing(4)
                            .padding(.top, 6)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 20)

                if title.isSeries && !app.seasons.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(app.seasons) { season in
                                Button {
                                    selectedSeason = season.seasonNumber
                                } label: {
                                    Text("Temporada \(season.seasonNumber)")
                                        .font(.system(size: 12, weight: selectedSeason == season.seasonNumber ? .bold : .regular))
                                        .foregroundStyle(selectedSeason == season.seasonNumber ? .white : MF.textMuted)
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 7)
                                        .background(selectedSeason == season.seasonNumber ? MF.red : MF.bgCard)
                                        .clipShape(Capsule())
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .padding(.bottom, 12)

                    ForEach(currentSeason?.episodes ?? []) { ep in
                        Button {
                            playerTarget = PlayerTarget(season: selectedSeason, episode: ep.episodeNumber)
                        } label: {
                            HStack(spacing: 12) {
                                AsyncImage(url: URL(string: ep.thumbnailUrl ?? "")) { phase in
                                    switch phase {
                                    case .success(let img): img.resizable().scaledToFill()
                                    default: MF.bgCard
                                    }
                                }
                                .frame(width: 96, height: 56)
                                .clipShape(RoundedRectangle(cornerRadius: 6))

                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(ep.episodeNumber). \(ep.title)")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(MF.textSoft)
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                    if let d = ep.durationSeconds {
                                        Text("\(d / 60) min")
                                            .font(.system(size: 11))
                                            .foregroundStyle(MF.textDim)
                                    }
                                }
                                Spacer()
                                Text("▶").foregroundStyle(MF.red)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .background(MF.bg)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if title.isSeries { await app.loadSeasons(title.tmdbId) }
        }
        .fullScreenCover(item: $playerTarget) { target in
            PlayerView(title: title, season: target.season, episode: target.episode)
        }
    }
}

// MARK: - Player

struct PlayerView: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss

    let title: Title
    let season: Int?
    let episode: Int?

    @State private var url: String?
    @State private var mode: String?
    @State private var message: String?
    @State private var loading = true

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if loading {
                ProgressView().tint(MF.red)
            } else if let msg = message {
                VStack(spacing: 18) {
                    Text(msg)
                        .font(.system(size: 15))
                        .foregroundStyle(MF.textSoft)
                        .multilineTextAlignment(.center)
                    Button("Voltar") { dismiss() }
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(MF.red)
                }
                .padding(28)
            } else if let u = url, let m = mode {
                if m == "direct" {
                    NativePlayer(url: u, title: title, season: season, episode: episode)
                        .ignoresSafeArea()
                } else {
                    EmbedWebView(url: u)
                        .ignoresSafeArea()
                }
            }

            VStack {
                HStack {
                    Button { dismiss() } label: {
                        Text("‹ Voltar")
                            .font(.system(size: 14))
                            .foregroundStyle(.white)
                            .padding(12)
                    }
                    Spacer()
                }
                Spacer()
            }
        }
        .task {
            let r = await app.authorize(tmdbId: title.tmdbId, season: season, episode: episode)
            url = r.url
            mode = r.mode
            message = r.message
            loading = false
        }
    }
}

/// MP4/HLS com AVPlayer — controles nativos do iOS.
struct NativePlayer: UIViewControllerRepresentable {
    @EnvironmentObject var app: AppState
    let url: String
    let title: Title
    let season: Int?
    let episode: Int?

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        guard let u = URL(string: url) else { return controller }
        let player = AVPlayer(url: u)
        controller.player = player
        controller.showsPlaybackControls = true
        player.play()

        // Salva a posição a cada 10s — alimenta "continuar assistindo" em
        // todos os dispositivos (mesma tabela watch_history).
        context.coordinator.timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in
            let pos = player.currentTime().seconds
            let dur = player.currentItem?.duration.seconds ?? 0
            if pos.isFinite, dur.isFinite, pos > 0, dur > 0 {
                Task { @MainActor in
                    app.saveProgress(
                        title,
                        position: pos,
                        duration: dur,
                        episodeId: (season != nil && episode != nil) ? "\(season!)/\(episode!)" : nil
                    )
                }
            }
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    static func dismantleUIViewController(_ uiViewController: AVPlayerViewController, coordinator: Coordinator) {
        coordinator.timer?.invalidate()
        uiViewController.player?.pause()
    }

    final class Coordinator {
        var timer: Timer?
    }
}

/// Página do provedor em WKWebView, com bloqueio de pop-up e de navegação
/// externa — o mesmo princípio do sandbox do site.
struct EmbedWebView: UIViewRepresentable {
    let url: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Bloqueio de pop-up: nenhuma janela nova é criada.
        config.preferences.javaScriptCanOpenWindowsAutomatically = false

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator

        if let u = URL(string: url) {
            webView.load(URLRequest(url: u))
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        /// Só o próprio provedor navega dentro do WebView. Qualquer outro
        /// destino é bloqueado — nada abre fora do app.
        private func isAllowed(_ url: URL?) -> Bool {
            guard let host = url?.host else { return false }
            return host.contains("myembed")
                || host.contains("streambetter")
                || host.contains("cloudflare")
                || host.contains("challenges.")
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.targetFrame == nil {
                // window.open / target=_blank: descartado.
                decisionHandler(.cancel)
                return
            }
            decisionHandler(isAllowed(navigationAction.request.url) ? .allow : .cancel)
        }

        /// Sem criação de janela nova.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            return nil
        }
    }
}
