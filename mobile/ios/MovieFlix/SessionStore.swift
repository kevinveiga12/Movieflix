import Foundation
import Security

/// Sessão guardada no **Keychain** do iOS.
///
/// Guarda apenas os tokens do Supabase — nunca a senha. A senha existe só em
/// memória durante a requisição de login.
final class SessionStore {
    static let shared = SessionStore()

    private let service = "run.velixir.movieflix.session"
    private let accessKey = "access_token"
    private let refreshKey = "refresh_token"
    private let emailKey = "email"
    private let userKey = "user_id"

    private init() {}

    var accessToken: String? { read(accessKey) }
    var refreshToken: String? { read(refreshKey) }
    var email: String? { read(emailKey) }
    var userId: String? { read(userKey) }
    var isLoggedIn: Bool { !(accessToken ?? "").isEmpty }

    func save(session: Session, email: String?, userId: String?) {
        write(accessKey, session.accessToken)
        write(refreshKey, session.refreshToken)
        if let e = email { write(emailKey, e) }
        if let u = userId { write(userKey, u) }
    }

    func clear() {
        [accessKey, refreshKey, emailKey, userKey].forEach { delete($0) }
    }

    // MARK: - Keychain

    private func query(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    private func read(_ key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let str = String(data: data, encoding: .utf8)
        else { return nil }
        return str
    }

    private func write(_ key: String, _ value: String) {
        let data = Data(value.utf8)
        let q = query(key)
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        if SecItemCopyMatching(q as CFDictionary, nil) == errSecSuccess {
            SecItemUpdate(q as CFDictionary, attrs as CFDictionary)
        } else {
            var add = q
            add.merge(attrs) { _, new in new }
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    private func delete(_ key: String) {
        SecItemDelete(query(key) as CFDictionary)
    }
}
