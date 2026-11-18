import SwiftUI

@main
struct MovieFlixApp: App {
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .preferredColorScheme(.dark)
                .tint(MF.red)
        }
    }
}

/// Abas principais — a mesma estrutura do app Android.
struct RootView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Início", systemImage: "house.fill") }

            CatalogView(kind: "movie")
                .tabItem { Label("Filmes", systemImage: "film.fill") }

            CatalogView(kind: "tv")
                .tabItem { Label("Séries", systemImage: "tv.fill") }

            FavoritesView()
                .tabItem { Label("Favoritos", systemImage: "heart.fill") }

            AccountView()
                .tabItem { Label("Conta", systemImage: "person.crop.circle.fill") }
        }
        .onAppear {
            let appearance = UITabBarAppearance()
            appearance.configureWithOpaqueBackground()
            appearance.backgroundColor = UIColor(MF.bgElev)
            UITabBar.appearance().standardAppearance = appearance
            UITabBar.appearance().scrollEdgeAppearance = appearance
        }
    }
}
