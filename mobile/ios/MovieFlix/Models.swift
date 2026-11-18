import Foundation

// Espelha src/lib/types.ts do site e Models.kt do Android.
// Os nomes de campo são os mesmos que a API devolve.

struct Title: Codable, Identifiable, Hashable {
    var id: String = ""
    var title: String = ""
    var description: String = ""
    var posterUrl: String = ""
    var backdropUrl: String = ""
    var videoUrl: String = ""
    var voteAverage: Double?
    var popularity: Double = 0
    var releaseDate: String = ""
    var category: String = ""
    var language: String = ""
    var quality: String = ""
    var type: String = "movie"
    var mediaType: String = "movie"
    var tmdbId: Int = 0
    var year: String = ""
    var duration: Int?
    var seasons: Int?
    var episodes: Int?
    var episodesAvailable: [String]?
    var dubladoPtbr: Bool?

    var isSeries: Bool { type == "tv" || mediaType == "tv" }
    var ratingLabel: String {
        guard let v = voteAverage else { return "—" }
        return String(format: "%.1f", v)
    }

    enum CodingKeys: String, CodingKey {
        case id, title, description, popularity, category, language, quality, type, year, duration, seasons, episodes
        case posterUrl = "poster_url"
        case backdropUrl = "backdrop_url"
        case videoUrl = "video_url"
        case voteAverage = "vote_average"
        case releaseDate = "release_date"
        case mediaType = "media_type"
        case tmdbId = "tmdb_id"
        case episodesAvailable = "episodes_available"
        case dubladoPtbr = "dublado_ptbr"
    }
}

struct CatalogResponse: Codable {
    var total: Int = 0
    var items: [Title] = []
}

struct GenresResponse: Codable {
    var genres: [String] = []
}

struct PublicConfig: Codable {
    var supabaseUrl: String = ""
    var supabaseAnonKey: String = ""
    var configured: Bool = false
}

struct Episode: Codable, Identifiable {
    var episodeNumber: Int = 0
    var title: String = ""
    var description: String = ""
    var videoUrl: String = ""
    var durationSeconds: Int?
    var thumbnailUrl: String?

    var id: Int { episodeNumber }

    enum CodingKeys: String, CodingKey {
        case title, description
        case episodeNumber = "episode_number"
        case videoUrl = "video_url"
        case durationSeconds = "duration_seconds"
        case thumbnailUrl = "thumbnail_url"
    }
}

struct Season: Codable, Identifiable {
    var seasonNumber: Int = 0
    var title: String = ""
    var posterUrl: String?
    var episodes: [Episode] = []

    var id: Int { seasonNumber }

    enum CodingKeys: String, CodingKey {
        case title, episodes
        case seasonNumber = "season_number"
        case posterUrl = "poster_url"
    }
}

struct SeasonsResponse: Codable {
    var seasons: [Season] = []
}

struct Session: Codable {
    var accessToken: String
    var refreshToken: String = ""
    var expiresAt: Int = 0

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
    }
}

struct AuthUser: Codable {
    var id: String = ""
    var email: String = ""
    var emailConfirmed: Bool = false

    enum CodingKeys: String, CodingKey {
        case id, email
        case emailConfirmed = "email_confirmed"
    }
}

struct Profile: Codable {
    var id: String = ""
    var email: String = ""
    var fullName: String?
    var isAdmin: Bool = false

    enum CodingKeys: String, CodingKey {
        case id, email
        case fullName = "full_name"
        case isAdmin = "is_admin"
    }
}

struct LoginResponse: Codable {
    var session: Session?
    var user: AuthUser?
    var profile: Profile?
    var isAdmin: Bool = false
    var error: String?
}

struct SignupResponse: Codable {
    var ok: Bool = false
    var email: String = ""
    var message: String = ""
    var error: String?
}

struct PlaybackSource: Codable {
    var url: String = ""
    var label: String?
    var mode: String = "embed"
}

struct PlaybackResponse: Codable {
    var allowed: Bool = false
    var reason: String?
    var message: String?
    var source: PlaybackSource?
}

struct PlanPeriod: Codable, Identifiable {
    var code: String = ""
    var label: String = ""
    var months: Int = 1
    var priceCents: Int = 0
    var priceLabel: String = ""
    var fullLabel: String?
    var savedLabel: String?
    var whatsappUrl: String = ""

    var id: String { code }

    enum CodingKeys: String, CodingKey {
        case code, label, months
        case priceCents = "price_cents"
        case priceLabel = "price_label"
        case fullLabel = "full_label"
        case savedLabel = "saved_label"
        case whatsappUrl = "whatsapp_url"
    }
}

struct Plan: Codable, Identifiable {
    var id: String = ""
    var name: String = ""
    var code: String = ""
    var description: String?
    var priceCents: Int = 0
    var priceLabel: String = ""
    var features: [String]?
    var isActive: Bool = true
    var periods: [PlanPeriod] = []

    enum CodingKeys: String, CodingKey {
        case id, name, code, description, features, periods
        case priceCents = "price_cents"
        case priceLabel = "price_label"
        case isActive = "is_active"
    }
}

struct PlansResponse: Codable {
    var plans: [Plan] = []
}

struct SubscriptionResponse: Codable {
    var allowed: Bool = false
    var reason: String?
    var message: String?
    var trialEndsAt: String?
    var daysLeft: Int?
    var plan: Plan?

    enum CodingKeys: String, CodingKey {
        case allowed, reason, message, plan
        case trialEndsAt = "trial_ends_at"
        case daysLeft = "days_left"
    }
}

struct FavoriteRow: Codable, Identifiable {
    var id: String = ""
    var userId: String = ""
    var tmdbId: Int = 0
    var mediaType: String = "movie"
    var title: String = ""
    var createdAt: String = ""

    enum CodingKeys: String, CodingKey {
        case id, title
        case userId = "user_id"
        case tmdbId = "tmdb_id"
        case mediaType = "media_type"
        case createdAt = "created_at"
    }
}

struct HistoryRow: Codable, Identifiable {
    var id: String = ""
    var userId: String = ""
    var tmdbId: Int = 0
    var mediaType: String = "movie"
    var title: String = ""
    var posterUrl: String = ""
    var positionSeconds: Double = 0
    var durationSeconds: Double = 0
    var progress: Double = 0
    var episodeId: String?
    var updatedAt: String = ""

    enum CodingKeys: String, CodingKey {
        case id, title, progress
        case userId = "user_id"
        case tmdbId = "tmdb_id"
        case mediaType = "media_type"
        case posterUrl = "poster_url"
        case positionSeconds = "position_seconds"
        case durationSeconds = "duration_seconds"
        case episodeId = "episode_id"
        case updatedAt = "updated_at"
    }
}
