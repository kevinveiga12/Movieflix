import SwiftUI

/// Card de pôster — mesma proporção 2:3 do site.
struct PosterCard: View {
    let title: Title
    var width: CGFloat = 118

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topLeading) {
                AsyncImage(url: URL(string: title.posterUrl)) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill()
                    default:
                        MF.bgCard
                    }
                }
                .frame(width: width, height: width * 1.5)
                .clipShape(RoundedRectangle(cornerRadius: 10))

                if !title.quality.isEmpty {
                    Text(title.quality)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(MF.red)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .padding(6)
                }
            }

            Text(title.title)
                .font(.system(size: 12))
                .foregroundStyle(MF.textSoft)
                .lineLimit(2)
                .frame(width: width, alignment: .leading)
        }
    }
}

/// Fileira horizontal com título de seção.
struct TitleRow: View {
    let heading: String
    let items: [Title]
    let onSelect: (Title) -> Void

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(heading)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(MF.text)
                    .padding(.horizontal, 16)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(items) { t in
                            Button { onSelect(t) } label: {
                                PosterCard(title: t)
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
}

/// Grade de pôsteres.
struct PosterGrid: View {
    let items: [Title]
    let onSelect: (Title) -> Void

    private let columns = [GridItem(.adaptive(minimum: 108), spacing: 10)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(items) { t in
                    Button { onSelect(t) } label: {
                        PosterCard(title: t, width: 108)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
    }
}

/// Banner de destaque no topo da home.
struct HeroBanner: View {
    let title: Title?
    let onPlay: () -> Void

    var body: some View {
        if let t = title {
            ZStack(alignment: .bottomLeading) {
                AsyncImage(url: URL(string: t.backdropUrl.isEmpty ? t.posterUrl : t.backdropUrl)) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    default: MF.bgCard
                    }
                }
                .frame(height: 300)
                .clipped()

                LinearGradient(
                    colors: [.clear, MF.bg.opacity(0.75), MF.bg],
                    startPoint: .top,
                    endPoint: .bottom
                )

                VStack(alignment: .leading, spacing: 6) {
                    Text(t.title)
                        .font(.system(size: 24, weight: .black))
                        .foregroundStyle(.white)
                        .lineLimit(2)

                    HStack(spacing: 10) {
                        Text("★ \(t.ratingLabel)").foregroundStyle(MF.warning)
                        Text(t.year).foregroundStyle(MF.textMuted)
                        if !t.category.isEmpty {
                            Text(t.category.split(separator: ",").first.map(String.init) ?? "")
                                .foregroundStyle(MF.textMuted)
                        }
                    }
                    .font(.system(size: 12))

                    Button(action: onPlay) {
                        Text("▶  Assistir")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 22)
                            .padding(.vertical, 10)
                            .background(MF.red)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .padding(.top, 6)
                }
                .padding(16)
            }
            .frame(height: 300)
        }
    }
}

struct LoadingView: View {
    var body: some View {
        VStack {
            ProgressView().tint(MF.red)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(MF.textMuted)
                .multilineTextAlignment(.center)
            Button("Tentar novamente", action: onRetry)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(MF.red)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct EmptyView_: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundStyle(MF.textMuted)
            .multilineTextAlignment(.center)
            .padding(28)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
