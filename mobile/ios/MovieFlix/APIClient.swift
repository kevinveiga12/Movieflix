import Foundation

/// Cliente HTTP do MovieFlix para iOS.
///
/// Fala com a MESMA API do site. Nenhum backend próprio, nenhuma chave privada:
/// a única credencial é o token de sessão do usuário, guardado no Keychain.
final class APIClient {
    static let shared = APIClient()

    /// Endereço público do MovieFlix. Trocar aqui aponta o app para outro host.
    let baseURL = URL(string: "https://movieflix.velixir.run")!

    private let session = SessionStore.shared
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    private init() {}

    // MARK: - Núcleo

    private func request(
        _ path: String,
        method: String = "GET",
        body: [String: Any]? = nil,
        auth: Bool = false
    ) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.badURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if auth, let token = session.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.noResponse }

        guard (200..<300).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw APIError.http(http.statusCode, text)
        }
        return data
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }

    // MARK: - Catálogo

    func movies(limit: Int = 60, offset: Int = 0, genre: String? = nil) async throws -> CatalogResponse {
        var path = "/api/catalog/movies?limit=\(limit)&offset=\(offset)"
        if let g = genre, let enc = g.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&genre=\(enc)"
        }
        return try decode(CatalogResponse.self, from: try await request(path))
    }

    func series(limit: Int = 60, offset: Int = 0, genre: String? = nil) async throws -> CatalogResponse {
        var path = "/api/catalog/series?limit=\(limit)&offset=\(offset)"
        if let g = genre, let enc = g.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&genre=\(enc)"
        }
        return try decode(CatalogResponse.self, from: try await request(path))
    }

    func search(_ term: String, limit: Int = 40) async throws -> CatalogResponse {
        let enc = term.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? term
        let m = try decode(CatalogResponse.self, from: try await request("/api/catalog/movies?q=\(enc)&limit=\(limit)"))
        let s = try decode(CatalogResponse.self, from: try await request("/api/catalog/series?q=\(enc)&limit=\(limit)"))
        return CatalogResponse(total: m.total + s.total, items: m.items + s.items)
    }

    func genres() async throws -> GenresResponse {
        try decode(GenresResponse.self, from: try await request("/api/catalog/genres"))
    }

    func seasons(tmdbId: Int) async throws -> SeasonsResponse {
        try decode(SeasonsResponse.self, from: try await request("/api/db/series/\(tmdbId)/episodes"))
    }

    // MARK: - Autenticação

    func login(email: String, password: String) async throws -> LoginResponse {
        let data = try await request(
            "/api/auth/login",
            method: "POST",
            body: ["email": email, "password": password]
        )
        let resp = try decode(LoginResponse.self, from: data)
        if let s = resp.session {
            session.save(session: s, email: resp.user?.email ?? email, userId: resp.user?.id)
        }
        return resp
    }

    func signup(email: String, password: String, fullName: String) async throws -> SignupResponse {
        let data = try await request(
            "/api/auth/signup",
            method: "POST",
            body: ["email": email, "password": password, "fullName": fullName]
        )
        return try decode(SignupResponse.self, from: data)
    }

    func requestRecoveryCode(email: String) async throws {
        _ = try await request("/api/auth/request-code", method: "POST", body: ["email": email])
    }

    func verifyRecoveryCode(email: String, code: String, newPassword: String) async throws {
        _ = try await request(
            "/api/auth/verify-code",
            method: "POST",
            body: ["email": email, "code": code, "newPassword": newPassword]
        )
    }

    func subscription() async throws -> SubscriptionResponse {
        try decode(SubscriptionResponse.self, from: try await request("/api/subscription", auth: true))
    }

    func plans(email: String?) async throws -> PlansResponse {
        var path = "/api/plans"
        if let e = email, let enc = e.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "?email=\(enc)"
        }
        return try decode(PlansResponse.self, from: try await request(path))
    }

    // MARK: - Reprodução

    /// A liberação é decidida SEMPRE no servidor (app_metadata + created_at).
    func authorizePlayback(tmdbId: Int, season: Int? = nil, episode: Int? = nil) async throws -> PlaybackResponse {
        var body: [String: Any] = ["tmdbId": tmdbId]
        if let s = season { body["season"] = s }
        if let e = episode { body["episode"] = e }
        let data = try await request("/api/playback/authorize", method: "POST", body: body, auth: true)
        return try decode(PlaybackResponse.self, from: data)
    }

    // MARK: - Favoritos e histórico (Supabase direto, RLS por usuário)

    private var supabaseURL: String?
    private var supabaseAnon: String?

    private func ensureSupabase() async throws {
        if supabaseURL != nil, supabaseAnon != nil { return }
        let cfg = try decode(PublicConfig.self, from: try await request("/api/config"))
        supabaseURL = cfg.supabaseUrl
        supabaseAnon = cfg.supabaseAnonKey
    }

    private func sbRequest(_ path: String, method: String = "GET", body: [String: Any]? = nil, prefer: String? = nil) async throws -> Data {
        try await ensureSupabase()
        guard let base = supabaseURL, let anon = supabaseAnon else { throw APIError.badURL }
        guard let url = URL(string: "\(base)/rest/v1/\(path)") else { throw APIError.badURL }
        guard let token = session.accessToken else { throw APIError.http(401, "sem sessão") }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue(anon, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let prefer { req.setValue(prefer, forHTTPHeaderField: "Prefer") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.noResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }

    func favorites() async throws -> [FavoriteRow] {
        guard let uid = session.userId else { return [] }
        let data = try await sbRequest(
            "favorites?select=id,user_id,tmdb_id,media_type,title,created_at&user_id=eq.\(uid)&order=created_at.desc"
        )
        return try decode([FavoriteRow].self, from: data)
    }

    /// Devolve `true` se ficou favoritado, `false` se foi removido.
    func toggleFavorite(_ t: Title, currentlyFavorite: Bool) async throws -> Bool {
        guard let uid = session.userId else { throw APIError.http(401, "sem sessão") }
        if currentlyFavorite {
            _ = try await sbRequest("favorites?user_id=eq.\(uid)&tmdb_id=eq.\(t.tmdbId)", method: "DELETE")
            return false
        }
        _ = try await sbRequest(
            "favorites",
            method: "POST",
            body: ["user_id": uid, "tmdb_id": t.tmdbId, "media_type": t.type, "title": t.title],
            prefer: "return=minimal"
        )
        return true
    }

    func history() async throws -> [HistoryRow] {
        guard let uid = session.userId else { return [] }
        let data = try await sbRequest(
            "watch_history?select=id,user_id,tmdb_id,media_type,title,poster_url,position_seconds,duration_seconds,progress,episode_id,updated_at&user_id=eq.\(uid)&order=updated_at.desc&limit=60"
        )
        return try decode([HistoryRow].self, from: data)
    }

    /// Grava a posição — é o que faz "continuar assistindo" atravessar
    /// iPhone, Android, TV e site (mesma tabela `watch_history`).
    func saveProgress(_ t: Title, position: Double, duration: Double, episodeId: String?) async throws {
        guard let uid = session.userId else { return }
        let progress = duration > 0 ? min(max(position / duration, 0), 1) : 0
        var body: [String: Any] = [
            "user_id": uid,
            "tmdb_id": t.tmdbId,
            "media_type": t.type,
            "title": t.title,
            "poster_url": t.posterUrl,
            "position_seconds": position,
            "duration_seconds": duration,
            "progress": progress,
            "updated_at": ISO8601DateFormatter().string(from: Date()),
        ]
        if let e = episodeId { body["episode_id"] = e }

        _ = try await sbRequest(
            "watch_history?on_conflict=user_id,tmdb_id,episode_id",
            method: "POST",
            body: body,
            prefer: "resolution=merge-duplicates,return=minimal"
        )
    }
}

enum APIError: LocalizedError {
    case badURL
    case noResponse
    case http(Int, String)
    case decoding(String)

    /// Mensagem curta em português — nunca expõe detalhe técnico ao cliente.
    var errorDescription: String? {
        switch self {
        case .badURL, .noResponse:
            return "Não foi possível conectar. Tente novamente."
        case .http(let code, _):
            switch code {
            case 401: return "Sua sessão expirou. Entre novamente."
            case 403: return "Esta conta não tem acesso a este conteúdo."
            case 404: return "Conteúdo não encontrado."
            case 429: return "Muitas tentativas. Aguarde um instante."
            default:
                return code >= 500
                    ? "O MovieFlix está instável. Tente em instantes."
                    : "Não foi possível concluir. Tente novamente."
            }
        case .decoding:
            return "Resposta inesperada do servidor."
        }
    }
}
