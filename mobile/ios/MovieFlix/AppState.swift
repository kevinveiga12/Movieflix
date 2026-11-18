import Foundation
import SwiftUI

/// Estado único do app iOS — uma fonte de verdade para todas as telas.
@MainActor
final class AppState: ObservableObject {
    @Published var movies: [Title] = []
    @Published var series: [Title] = []
    @Published var searchResults: [Title] = []
    @Published var genres: [String] = []
    @Published var favorites: [FavoriteRow] = []
    @Published var history: [HistoryRow] = []
    @Published var plans: [Plan] = []
    @Published var subscription: SubscriptionResponse?
    @Published var seasons: [Season] = []

    @Published var loading = false
    @Published var errorMessage: String?
    @Published var toast: String?

    @Published var loggedIn = SessionStore.shared.isLoggedIn
    @Published var email: String? = SessionStore.shared.email
    @Published var isAdmin = false

    private let api = APIClient.shared

    init() {
        Task {
            await loadHome()
            if loggedIn {
                await loadUserData()
                await loadSubscription()
            }
        }
    }

    // MARK: - Catálogo

    func loadHome() async {
        loading = true
        errorMessage = nil
        do {
            async let m = api.movies(limit: 40)
            async let s = api.series(limit: 40)
            let (moviesResp, seriesResp) = try await (m, s)
            movies = moviesResp.items
            series = seriesResp.items
            if let g = try? await api.genres() { genres = g.genres }
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    func loadCatalog(kind: String) async {
        loading = true
        errorMessage = nil
        do {
            if kind == "tv" {
                series = try await api.series(limit: 60).items
            } else {
                movies = try await api.movies(limit: 60).items
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    func search(_ term: String) async {
        guard !term.trimmingCharacters(in: .whitespaces).isEmpty else {
            searchResults = []
            return
        }
        loading = true
        do {
            searchResults = try await api.search(term).items
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    func loadSeasons(_ tmdbId: Int) async {
        do {
            seasons = try await api.seasons(tmdbId: tmdbId).seasons
        } catch {
            seasons = []
        }
    }

    // MARK: - Conta

    func login(email: String, password: String) async -> String? {
        loading = true
        defer { loading = false }
        do {
            let r = try await api.login(email: email, password: password)
            guard r.session != nil else { return r.error ?? "Não foi possível entrar." }
            loggedIn = true
            self.email = r.user?.email ?? email
            isAdmin = r.isAdmin
            await loadUserData()
            await loadSubscription()
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    func signup(email: String, password: String, name: String) async -> String? {
        loading = true
        defer { loading = false }
        do {
            let r = try await api.signup(email: email, password: password, fullName: name)
            return r.ok ? nil : (r.error ?? "Não foi possível criar a conta.")
        } catch {
            return error.localizedDescription
        }
    }

    func requestCode(_ email: String) async -> String? {
        do {
            try await api.requestRecoveryCode(email: email)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    func verifyCode(email: String, code: String, newPassword: String) async -> String? {
        do {
            try await api.verifyRecoveryCode(email: email, code: code, newPassword: newPassword)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    func logout() {
        SessionStore.shared.clear()
        loggedIn = false
        email = nil
        isAdmin = false
        favorites = []
        history = []
        subscription = nil
    }

    func loadUserData() async {
        guard loggedIn else { return }
        favorites = (try? await api.favorites()) ?? []
        history = (try? await api.history()) ?? []
    }

    func loadSubscription() async {
        guard loggedIn else { return }
        subscription = try? await api.subscription()
    }

    func loadPlans() async {
        plans = (try? await api.plans(email: email))?.plans ?? []
    }

    func isFavorite(_ tmdbId: Int) -> Bool {
        favorites.contains { $0.tmdbId == tmdbId }
    }

    func toggleFavorite(_ t: Title) async {
        guard loggedIn else {
            toast = "Entre na sua conta para salvar favoritos."
            return
        }
        do {
            let now = try await api.toggleFavorite(t, currentlyFavorite: isFavorite(t.tmdbId))
            toast = now ? "Adicionado aos favoritos" : "Removido dos favoritos"
            await loadUserData()
        } catch {
            toast = error.localizedDescription
        }
    }

    // MARK: - Reprodução

    /// Pede autorização ao servidor. O app nunca libera conteúdo sozinho.
    func authorize(tmdbId: Int, season: Int?, episode: Int?) async -> (url: String?, mode: String?, message: String?) {
        guard loggedIn else {
            return (nil, nil, "Crie sua conta ou entre para assistir.")
        }
        do {
            let r = try await api.authorizePlayback(tmdbId: tmdbId, season: season, episode: episode)
            if r.allowed, let src = r.source {
                return (src.url, src.mode, nil)
            }
            return (nil, nil, r.message ?? "Não foi possível liberar este título.")
        } catch {
            return (nil, nil, error.localizedDescription)
        }
    }

    func saveProgress(_ t: Title, position: Double, duration: Double, episodeId: String?) {
        guard loggedIn else { return }
        Task {
            try? await api.saveProgress(t, position: position, duration: duration, episodeId: episodeId)
        }
    }
}
