package run.velixir.movieflix

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import run.velixir.movieflix.data.ApiException
import run.velixir.movieflix.data.FavoriteRow
import run.velixir.movieflix.data.HistoryRow
import run.velixir.movieflix.data.MovieFlixApi
import run.velixir.movieflix.data.Plan
import run.velixir.movieflix.data.Season
import run.velixir.movieflix.data.SessionStore
import run.velixir.movieflix.data.SubscriptionResponse
import run.velixir.movieflix.data.Title

/** Estado único da aplicação — uma fonte de verdade para todas as telas. */
data class UiState(
    val loading: Boolean = false,
    val error: String? = null,
    val movies: List<Title> = emptyList(),
    val series: List<Title> = emptyList(),
    val searchResults: List<Title> = emptyList(),
    val genres: List<String> = emptyList(),
    val favorites: List<FavoriteRow> = emptyList(),
    val history: List<HistoryRow> = emptyList(),
    val plans: List<Plan> = emptyList(),
    val subscription: SubscriptionResponse? = null,
    val loggedIn: Boolean = false,
    val email: String? = null,
    val isAdmin: Boolean = false,
    val seasons: List<Season> = emptyList(),
    val toast: String? = null,
)

class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val session = SessionStore(app)
    private val api = MovieFlixApi(BuildConfig.API_BASE_URL, session)

    private val _state = MutableStateFlow(
        UiState(loggedIn = session.isLoggedIn, email = session.email),
    )
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        loadHome()
        if (session.isLoggedIn) {
            loadUserData()
            loadSubscription()
        }
    }

    private fun update(block: (UiState) -> UiState) {
        _state.value = block(_state.value)
    }

    fun clearToast() = update { it.copy(toast = null) }

    // ── Catálogo ────────────────────────────────────────────────────────────

    fun loadHome() {
        viewModelScope.launch {
            update { it.copy(loading = true, error = null) }
            try {
                val movies = api.movies(limit = 40)
                val series = api.series(limit = 40)
                val genres = runCatching { api.genres() }.getOrNull()
                update {
                    it.copy(
                        loading = false,
                        movies = movies.items,
                        series = series.items,
                        genres = genres?.genres ?: emptyList(),
                    )
                }
            } catch (e: Exception) {
                update { it.copy(loading = false, error = friendly(e)) }
            }
        }
    }

    fun loadCatalog(kind: String, genre: String? = null) {
        viewModelScope.launch {
            update { it.copy(loading = true, error = null) }
            try {
                val resp = if (kind == "tv") api.series(limit = 60, genre = genre)
                else api.movies(limit = 60, genre = genre)
                update {
                    if (kind == "tv") it.copy(loading = false, series = resp.items)
                    else it.copy(loading = false, movies = resp.items)
                }
            } catch (e: Exception) {
                update { it.copy(loading = false, error = friendly(e)) }
            }
        }
    }

    fun search(term: String) {
        if (term.isBlank()) {
            update { it.copy(searchResults = emptyList()) }
            return
        }
        viewModelScope.launch {
            update { it.copy(loading = true, error = null) }
            try {
                val r = api.search(term)
                update { it.copy(loading = false, searchResults = r.items) }
            } catch (e: Exception) {
                update { it.copy(loading = false, error = friendly(e)) }
            }
        }
    }

    fun loadSeasons(tmdbId: Long) {
        viewModelScope.launch {
            try {
                val r = api.seasons(tmdbId)
                update { it.copy(seasons = r.seasons) }
            } catch (e: Exception) {
                update { it.copy(seasons = emptyList()) }
            }
        }
    }

    // ── Conta ───────────────────────────────────────────────────────────────

    fun login(email: String, password: String, onDone: (String?) -> Unit) {
        viewModelScope.launch {
            update { it.copy(loading = true, error = null) }
            try {
                val r = api.login(email.trim(), password)
                if (r.session == null) {
                    update { it.copy(loading = false) }
                    onDone(r.error ?: "Não foi possível entrar.")
                    return@launch
                }
                update {
                    it.copy(
                        loading = false,
                        loggedIn = true,
                        email = r.user?.email ?: email,
                        isAdmin = r.isAdmin,
                    )
                }
                loadUserData()
                loadSubscription()
                onDone(null)
            } catch (e: Exception) {
                update { it.copy(loading = false) }
                onDone(friendly(e))
            }
        }
    }

    fun signup(email: String, password: String, name: String, onDone: (String?) -> Unit) {
        viewModelScope.launch {
            update { it.copy(loading = true) }
            try {
                val r = api.signup(email.trim(), password, name.trim())
                update { it.copy(loading = false) }
                if (r.ok) onDone(null) else onDone(r.error ?: "Não foi possível criar a conta.")
            } catch (e: Exception) {
                update { it.copy(loading = false) }
                onDone(friendly(e))
            }
        }
    }

    fun requestCode(email: String, onDone: (String?) -> Unit) {
        viewModelScope.launch {
            try {
                api.requestRecoveryCode(email.trim())
                onDone(null)
            } catch (e: Exception) {
                onDone(friendly(e))
            }
        }
    }

    fun verifyCode(email: String, code: String, newPass: String, onDone: (String?) -> Unit) {
        viewModelScope.launch {
            try {
                api.verifyRecoveryCode(email.trim(), code.trim(), newPass)
                onDone(null)
            } catch (e: Exception) {
                onDone(friendly(e))
            }
        }
    }

    fun logout() {
        session.clear()
        update {
            it.copy(
                loggedIn = false,
                email = null,
                isAdmin = false,
                favorites = emptyList(),
                history = emptyList(),
                subscription = null,
            )
        }
    }

    fun loadUserData() {
        if (!session.isLoggedIn) return
        viewModelScope.launch {
            val favs = runCatching { api.favorites() }.getOrDefault(emptyList())
            val hist = runCatching { api.history() }.getOrDefault(emptyList())
            update { it.copy(favorites = favs, history = hist) }
        }
    }

    fun loadSubscription() {
        if (!session.isLoggedIn) return
        viewModelScope.launch {
            val sub = runCatching { api.subscription() }.getOrNull()
            update { it.copy(subscription = sub) }
        }
    }

    fun loadPlans() {
        viewModelScope.launch {
            val p = runCatching { api.plans(session.email) }.getOrNull()
            update { it.copy(plans = p?.plans ?: emptyList()) }
        }
    }

    fun isFavorite(tmdbId: Long): Boolean =
        _state.value.favorites.any { it.tmdbId == tmdbId }

    fun toggleFavorite(t: Title) {
        if (!session.isLoggedIn) {
            update { it.copy(toast = "Entre na sua conta para salvar favoritos.") }
            return
        }
        viewModelScope.launch {
            try {
                val nowFav = api.toggleFavorite(t, isFavorite(t.tmdbId))
                update {
                    it.copy(toast = if (nowFav) "Adicionado aos favoritos" else "Removido dos favoritos")
                }
                loadUserData()
            } catch (e: Exception) {
                update { it.copy(toast = friendly(e)) }
            }
        }
    }

    // ── Reprodução ──────────────────────────────────────────────────────────

    /**
     * Pede autorização ao servidor e devolve a URL a tocar.
     * A liberação é decidida no backend — o app nunca libera por conta própria.
     */
    fun authorize(
        tmdbId: Long,
        season: Int?,
        episode: Int?,
        onResult: (url: String?, mode: String?, message: String?) -> Unit,
    ) {
        if (!session.isLoggedIn) {
            onResult(null, null, "Crie sua conta ou entre para assistir.")
            return
        }
        viewModelScope.launch {
            try {
                val r = api.authorizePlayback(tmdbId, season, episode)
                if (r.allowed && r.source != null) {
                    onResult(r.source.url, r.source.mode, null)
                } else {
                    onResult(null, null, r.message ?: "Não foi possível liberar este título.")
                }
            } catch (e: Exception) {
                onResult(null, null, friendly(e))
            }
        }
    }

    fun saveProgress(t: Title, pos: Double, dur: Double, episodeId: String?) {
        if (!session.isLoggedIn) return
        viewModelScope.launch {
            runCatching { api.saveProgress(t, pos, dur, episodeId) }
        }
    }

    /** Mensagem curta em português — nunca expõe detalhe técnico ao cliente. */
    private fun friendly(e: Exception): String = when {
        e is ApiException && e.status == 401 -> "Sua sessão expirou. Entre novamente."
        e is ApiException && e.status == 403 -> "Esta conta não tem acesso a este conteúdo."
        e is ApiException && e.status >= 500 -> "O MovieFlix está instável. Tente em instantes."
        e is java.net.UnknownHostException -> "Sem conexão com a internet."
        e is java.net.SocketTimeoutException -> "A conexão demorou demais. Tente de novo."
        else -> "Não foi possível concluir. Tente novamente."
    }
}
