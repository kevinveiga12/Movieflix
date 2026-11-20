package run.velixir.movieflix.tv

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import run.velixir.movieflix.tv.data.AdminStats
import run.velixir.movieflix.tv.data.ApiException
import run.velixir.movieflix.tv.data.FavoriteRow
import run.velixir.movieflix.tv.data.HistoryRow
import run.velixir.movieflix.tv.data.MovieFlixApi
import run.velixir.movieflix.tv.data.Plan
import run.velixir.movieflix.tv.data.Season
import run.velixir.movieflix.tv.data.SessionStore
import run.velixir.movieflix.tv.data.SubscriptionResponse
import run.velixir.movieflix.tv.data.Title

data class TvState(
    val loading: Boolean = false,
    val error: String? = null,
    val movies: List<Title> = emptyList(),
    val series: List<Title> = emptyList(),
    val searchResults: List<Title> = emptyList(),
    val favorites: List<FavoriteRow> = emptyList(),
    val history: List<HistoryRow> = emptyList(),
    val seasons: List<Season> = emptyList(),
    val genres: List<String> = emptyList(),
    val plans: List<Plan> = emptyList(),
    val subscription: SubscriptionResponse? = null,
    val loggedIn: Boolean = false,
    val email: String? = null,
    val isAdmin: Boolean = false,
    val adminStats: AdminStats? = null,
    val adminError: String? = null,
    val toast: String? = null,
)

/**
 * ViewModel da TV. Usa a MESMA API e as MESMAS tabelas do site e do mobile —
 * favoritar na TV aparece no celular e no site, e o histórico é o mesmo.
 */
class TvViewModel(app: Application) : AndroidViewModel(app) {

    private val session = SessionStore(app)
    private val api = MovieFlixApi(BuildConfig.API_BASE_URL, session)

    /**
     * tmdb_id → URL da capa, montado a partir do catálogo.
     *
     * Fica em memória porque a tabela `favorites` não guarda `poster_url` e o
     * `watch_history` pode ter linhas antigas sem ela. Ver [resolvePosters].
     */
    private val posterIndex = mutableMapOf<Long, String>()

    private val _state = MutableStateFlow(
        TvState(
            loggedIn = session.isLoggedIn,
            email = session.email,
            isAdmin = session.isLoggedIn && session.isAdmin,
        ),
    )
    val state: StateFlow<TvState> = _state.asStateFlow()

    init {
        loadHome()
        if (session.isLoggedIn) {
            loadUserData()
            loadSubscription()
        }
    }

    private fun update(block: (TvState) -> TvState) {
        _state.value = block(_state.value)
    }

    fun clearToast() = update { it.copy(toast = null) }

    fun loadHome() {
        viewModelScope.launch {
            update { it.copy(loading = true, error = null) }
            try {
                val m = api.movies(limit = 40)
                val s = api.series(limit = 40)
                val g = runCatching { api.genres() }.getOrNull()
                update {
                    it.copy(
                        loading = false,
                        movies = m.items,
                        series = s.items,
                        genres = g?.genres ?: emptyList(),
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
                val r = if (kind == "tv") api.series(limit = 60, genre = genre)
                else api.movies(limit = 60, genre = genre)
                update {
                    if (kind == "tv") it.copy(loading = false, series = r.items)
                    else it.copy(loading = false, movies = r.items)
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
            update { it.copy(loading = true) }
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
            val r = runCatching { api.seasons(tmdbId) }.getOrNull()
            update { it.copy(seasons = r?.seasons ?: emptyList()) }
        }
    }

    fun login(email: String, password: String, onDone: (String?) -> Unit) {
        viewModelScope.launch {
            update { it.copy(loading = true) }
            try {
                val r = api.login(email.trim(), password)
                if (r.session == null) {
                    update { it.copy(loading = false) }
                    onDone(r.error ?: "Não foi possível entrar.")
                    return@launch
                }
                update {
                    it.copy(loading = false, loggedIn = true, email = r.user?.email ?: email, isAdmin = r.isAdmin)
                }
                session.isAdmin = r.isAdmin
                loadUserData()
                loadSubscription()
                onDone(null)
            } catch (e: Exception) {
                update { it.copy(loading = false) }
                onDone(friendly(e))
            }
        }
    }

    fun logout() {
        session.clear()
        update {
            it.copy(loggedIn = false, email = null, isAdmin = false, adminStats = null, favorites = emptyList(), history = emptyList())
        }
    }

    fun loadUserData() {
        if (!session.isLoggedIn) return
        viewModelScope.launch {
            val f = runCatching { api.favorites() }.getOrDefault(emptyList())
            val h = runCatching { api.history() }.getOrDefault(emptyList())
            update { it.copy(favorites = f, history = h) }
            // As capas vêm do catálogo, não do banco (ver FavoriteRow).
            resolvePosters()
        }
    }

    /**
     * Preenche a capa de favoritos e histórico a partir do catálogo.
     *
     * Por que isto é necessário: a tabela `favorites` não tem `poster_url` e a
     * `watch_history` só a tem quando a linha foi gravada por uma versão que já
     * a enviava — linhas antigas ficam com string vazia. O site resolve a capa
     * pelo catálogo (`getById`), e é o que fazemos aqui.
     *
     * ── O que estava errado antes ────────────────────────────────────────────
     *
     * A versão anterior varria o catálogo em páginas de 200 (`api.movies` +
     * `api.series`) até achar os ids, com um teto de 2.000 itens. O catálogo
     * tem 18.003 filmes e 8.088 séries: o laço nunca chegava nos títulos do
     * usuário, então a maioria das capas continuava vazia e o card aparecia
     * cinza. Além disso eram dezenas de requisições por visita à tela.
     *
     * Agora é UMA requisição para até 200 ids (`/api/catalog/posters`), que
     * resolve por índice no servidor. O resultado fica em [posterIndex] para
     * não repetir a chamada a cada visita.
     */
    private suspend fun resolvePosters() {
        val need = (_state.value.favorites.map { it.tmdbId } +
            _state.value.history.map { it.tmdbId })
            .filter { it > 0 && posterIndex[it] == null }
            .distinct()

        if (need.isNotEmpty()) {
            // Em lotes de 200 (o limite da rota), para o caso de um histórico
            // muito grande. Normalmente é uma chamada só.
            for (chunk in need.chunked(200)) {
                val found = runCatching { api.posters(chunk) }.getOrDefault(emptyMap())
                posterIndex.putAll(found)
            }
        }

        applyPosters()
    }

    private fun applyPosters() {
        update { st ->
            st.copy(
                favorites = st.favorites.map { f ->
                    if (f.posterUrl.isNotBlank()) f
                    else f.copy(posterUrl = posterIndex[f.tmdbId] ?: "")
                },
                history = st.history.map { h ->
                    if (h.posterUrl.isNotBlank()) h
                    else h.copy(posterUrl = posterIndex[h.tmdbId] ?: "")
                },
            )
        }
    }

    fun loadSubscription() {
        if (!session.isLoggedIn) return
        viewModelScope.launch {
            val s = runCatching { api.subscription() }.getOrNull()
            update { it.copy(subscription = s) }
        }
    }

    fun loadPlans() {
        viewModelScope.launch {
            val p = runCatching { api.plans(session.email) }.getOrNull()
            update { it.copy(plans = p?.plans ?: emptyList()) }
        }
    }

    /** Números do painel — só para admin; o servidor revalida a cada chamada. */
    fun loadAdminStats() {
        if (!_state.value.isAdmin) return
        viewModelScope.launch {
            try {
                val st = api.adminStats()
                update { it.copy(adminStats = st, adminError = null) }
            } catch (e: Exception) {
                update { it.copy(adminStats = null, adminError = friendly(e)) }
            }
        }
    }

    fun isFavorite(tmdbId: Long) = _state.value.favorites.any { it.tmdbId == tmdbId }

    fun toggleFavorite(t: Title) {
        if (!session.isLoggedIn) {
            update { it.copy(toast = "Entre na sua conta para salvar favoritos.") }
            return
        }
        viewModelScope.launch {
            try {
                val now = api.toggleFavorite(t, isFavorite(t.tmdbId))
                update { it.copy(toast = if (now) "Adicionado aos favoritos" else "Removido") }
                loadUserData()
            } catch (e: Exception) {
                update { it.copy(toast = friendly(e)) }
            }
        }
    }

    fun authorize(
        tmdbId: Long,
        season: Int?,
        episode: Int?,
        onResult: (String?, String?, String?, String?) -> Unit,
    ) {
        if (!session.isLoggedIn) {
            // Sem sessão: NÃO é erro de reprodução — é falta de login. O 4º
            // argumento ("unauthenticated") faz a tela mandar ao login em vez
            // de mostrar a mensagem com "Voltar".
            onResult(null, null, "Entre na sua conta para assistir.", "unauthenticated")
            return
        }
        viewModelScope.launch {
            try {
                val r = api.authorizePlayback(tmdbId, season, episode)
                if (r.allowed && r.source != null) onResult(r.source.url, r.source.mode, null, null)
                else onResult(null, null, r.message ?: "Não foi possível liberar este título.", r.reason)
            } catch (e: Exception) {
                /*
                  Token expirado/inválido: a sessão guardada no aparelho não vale
                  mais. Antes o app continuava "logado" (o token existia) e o
                  player abria mostrando um erro — dava a impressão de que dava
                  para assistir sem conta. Agora a sessão é descartada e o estado
                  volta a deslogado, o que faz a tela mandar a pessoa ao login.
                */
                if (e is ApiException && e.status == 401) {
                    session.clear()
                    update {
                        it.copy(
                            loggedIn = false,
                            email = null,
                            isAdmin = false,
                            favorites = emptyList(),
                            history = emptyList(),
                        )
                    }
                    // 401 = sessão inválida: manda ao login, não mostra erro.
                    onResult(null, null, friendly(e), "unauthenticated")
                    return@launch
                }
                onResult(null, null, friendly(e), null)
            }
        }
    }

    fun saveProgress(t: Title, pos: Double, dur: Double, episodeId: String?) {
        if (!session.isLoggedIn) return
        viewModelScope.launch { runCatching { api.saveProgress(t, pos, dur, episodeId) } }
    }

    private fun friendly(e: Exception): String = when {
        e is ApiException && e.status == 401 -> "Sua sessão expirou. Entre novamente."
        e is ApiException && e.status >= 500 -> "O MovieFlix está instável. Tente em instantes."
        e is java.net.UnknownHostException -> "Sem conexão com a internet."
        else -> "Não foi possível concluir. Tente novamente."
    }
}
