package run.velixir.movieflix.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Sessão persistida em armazenamento criptografado (AES-256 via Android Keystore).
 *
 * Guarda apenas o access_token e o refresh_token do Supabase — nunca a senha.
 * A senha existe só na memória durante a requisição de login.
 *
 * IMPORTANTE: `EncryptedSharedPreferences.create` pode lançar exceção em
 * aparelhos com Keystore corrompido ou ROM modificada. Se isso acontecesse
 * dentro do construtor do ViewModel, o app morreria na inicialização — tela
 * preta. Por isso há um fallback para SharedPreferences comum: pior em
 * segurança, mas o app abre. O token continua sendo só do próprio usuário.
 */
class SessionStore(context: Context) {

    private val prefs: SharedPreferences = runCatching {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "movieflix_session",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        ) as SharedPreferences
    }.getOrElse {
        // Keystore indisponível: o app precisa abrir de qualquer forma.
        context.getSharedPreferences("movieflix_session_plain", Context.MODE_PRIVATE)
    }

    var accessToken: String?
        get() = prefs.getString(KEY_ACCESS, null)
        set(value) = prefs.edit().putString(KEY_ACCESS, value).apply()

    var refreshToken: String?
        get() = prefs.getString(KEY_REFRESH, null)
        set(value) = prefs.edit().putString(KEY_REFRESH, value).apply()

    var email: String?
        get() = prefs.getString(KEY_EMAIL, null)
        set(value) = prefs.edit().putString(KEY_EMAIL, value).apply()

    var userId: String?
        get() = prefs.getString(KEY_USER, null)
        set(value) = prefs.edit().putString(KEY_USER, value).apply()

    /**
     * Último `is_admin` conhecido, vindo do servidor no login.
     *
     * Guardado só para o menu não piscar ao reabrir o app. NÃO é fonte de
     * verdade: a cada abertura o app revalida em /api/profile/ensure, e toda
     * rota /api/admin/* revalida de novo no servidor. Alterar este valor no
     * aparelho não dá acesso a nada.
     */
    var isAdmin: Boolean
        get() = prefs.getBoolean(KEY_ADMIN, false)
        set(value) = prefs.edit().putBoolean(KEY_ADMIN, value).apply()

    val isLoggedIn: Boolean get() = !accessToken.isNullOrBlank()

    fun save(session: Session, userEmail: String?, uid: String?) {
        prefs.edit()
            .putString(KEY_ACCESS, session.accessToken)
            .putString(KEY_REFRESH, session.refreshToken)
            .putString(KEY_EMAIL, userEmail)
            .putString(KEY_USER, uid)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_ACCESS = "access_token"
        const val KEY_REFRESH = "refresh_token"
        const val KEY_EMAIL = "email"
        const val KEY_USER = "user_id"
        const val KEY_ADMIN = "is_admin"
    }
}
