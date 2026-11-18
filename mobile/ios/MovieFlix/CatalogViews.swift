import SwiftUI

// MARK: - Home

struct HomeView: View {
    @EnvironmentObject var app: AppState
    @State private var showSearch = false
    @State private var selected: Title?

    var body: some View {
        NavigationStack {
            Group {
                if app.loading && app.movies.isEmpty {
                    LoadingView()
                } else if let err = app.errorMessage, app.movies.isEmpty {
                    ErrorView(message: err) { Task { await app.loadHome() } }
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            HStack {
                                Text("MOVIEFLIX")
                                    .font(.system(size: 22, weight: .black))
                                    .foregroundStyle(MF.red)
                                    .tracking(1)
                                Spacer()
                                Button { showSearch = true } label: {
                                    Image(systemName: "magnifyingglass")
                                        .foregroundStyle(MF.textSoft)
                                        .frame(width: 38, height: 38)
                                        .background(MF.bgCard)
                                        .clipShape(Circle())
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)

                            HeroBanner(title: app.movies.first) {
                                if let first = app.movies.first { selected = first }
                            }

                            TitleRow(heading: "Filmes", items: app.movies) { selected = $0 }
                            TitleRow(heading: "Séries", items: app.series) { selected = $0 }

                            if !app.history.isEmpty {
                                ContinueWatchingRow(items: app.history) { selected = $0 }
                            }
                        }
                        .padding(.bottom, 24)
                    }
                }
            }
            .background(MF.bg)
            .navigationDestination(item: $selected) { t in
                DetailView(title: t)
            }
            .sheet(isPresented: $showSearch) {
                SearchView()
            }
        }
    }
}

struct ContinueWatchingRow: View {
    let items: [HistoryRow]
    let onSelect: (Title) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Continuar assistindo")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(MF.text)
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(items) { h in
                        Button {
                            onSelect(
                                Title(
                                    id: String(h.tmdbId),
                                    title: h.title,
                                    posterUrl: h.posterUrl,
                                    type: h.mediaType,
                                    mediaType: h.mediaType,
                                    tmdbId: h.tmdbId
                                )
                            )
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                ZStack(alignment: .bottomLeading) {
                                    AsyncImage(url: URL(string: h.posterUrl)) { phase in
                                        switch phase {
                                        case .success(let img): img.resizable().scaledToFill()
                                        default: MF.bgCard
                                        }
                                    }
                                    .frame(width: 150, height: 84)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))

                                    GeometryReader { geo in
                                        Rectangle()
                                            .fill(MF.red)
                                            .frame(width: geo.size.width * min(max(h.progress, 0), 1), height: 3)
                                            .frame(maxHeight: .infinity, alignment: .bottom)
                                    }
                                    .frame(width: 150, height: 84)
                                }
                                Text(h.title)
                                    .font(.system(size: 11))
                                    .foregroundStyle(MF.textSoft)
                                    .lineLimit(1)
                                    .frame(width: 150, alignment: .leading)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.bottom, 18)
    }
}

// MARK: - Catálogo

struct CatalogView: View {
    @EnvironmentObject var app: AppState
    let kind: String
    @State private var selected: Title?

    private var items: [Title] { kind == "tv" ? app.series : app.movies }

    var body: some View {
        NavigationStack {
            Group {
                if app.loading && items.isEmpty {
                    LoadingView()
                } else if items.isEmpty {
                    EmptyView_(text: "Nada por aqui ainda.")
                } else {
                    PosterGrid(items: items) { selected = $0 }
                }
            }
            .background(MF.bg)
            .navigationTitle(kind == "tv" ? "Séries" : "Filmes")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(MF.bg, for: .navigationBar)
            .navigationDestination(item: $selected) { DetailView(title: $0) }
            .task { if items.isEmpty { await app.loadCatalog(kind: kind) } }
        }
    }
}

// MARK: - Busca

struct SearchView: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var term = ""
    @State private var selected: Title?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(MF.textDim)
                    TextField("Buscar filmes e séries", text: $term)
                        .foregroundStyle(MF.text)
                        .autocorrectionDisabled()
                        .onSubmit { Task { await app.search(term) } }
                        .onChange(of: term) { _, newValue in
                            Task { await app.search(newValue) }
                        }
                }
                .padding(12)
                .background(MF.bgCard)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(16)

                if term.isEmpty {
                    EmptyView_(text: "Digite para buscar no catálogo.")
                } else if app.loading {
                    LoadingView()
                } else if app.searchResults.isEmpty {
                    EmptyView_(text: "Nenhum resultado para \"\(term)\".")
                } else {
                    PosterGrid(items: app.searchResults) { selected = $0 }
                }
            }
            .background(MF.bg)
            .navigationTitle("Buscar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Fechar") { dismiss() }.foregroundStyle(MF.red)
                }
            }
            .navigationDestination(item: $selected) { DetailView(title: $0) }
        }
    }
}

// MARK: - Favoritos

struct FavoritesView: View {
    @EnvironmentObject var app: AppState
    @State private var selected: Title?

    var body: some View {
        NavigationStack {
            Group {
                if !app.loggedIn {
                    EmptyView_(text: "Entre na sua conta para ver seus favoritos.")
                } else if app.favorites.isEmpty {
                    EmptyView_(text: "Você ainda não salvou favoritos.")
                } else {
                    PosterGrid(items: app.favorites.map {
                        Title(
                            id: String($0.tmdbId),
                            title: $0.title,
                            type: $0.mediaType,
                            mediaType: $0.mediaType,
                            tmdbId: $0.tmdbId
                        )
                    }) { selected = $0 }
                }
            }
            .background(MF.bg)
            .navigationTitle("Favoritos")
            .navigationBarTitleDisplayMode(.large)
            .navigationDestination(item: $selected) { DetailView(title: $0) }
            .task { await app.loadUserData() }
        }
    }
}

// MARK: - Histórico

struct HistoryView: View {
    @EnvironmentObject var app: AppState
    @State private var selected: Title?

    var body: some View {
        NavigationStack {
            Group {
                if !app.loggedIn {
                    EmptyView_(text: "Entre na sua conta para ver seu histórico.")
                } else if app.history.isEmpty {
                    EmptyView_(text: "Nada no histórico ainda.")
                } else {
                    PosterGrid(items: app.history.map {
                        Title(
                            id: String($0.tmdbId),
                            title: $0.title,
                            posterUrl: $0.posterUrl,
                            type: $0.mediaType,
                            mediaType: $0.mediaType,
                            tmdbId: $0.tmdbId
                        )
                    }) { selected = $0 }
                }
            }
            .background(MF.bg)
            .navigationTitle("Histórico")
            .navigationBarTitleDisplayMode(.large)
            .navigationDestination(item: $selected) { DetailView(title: $0) }
            .task { await app.loadUserData() }
        }
    }
}
