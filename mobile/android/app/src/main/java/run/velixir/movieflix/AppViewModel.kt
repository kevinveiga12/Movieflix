package run.velixir.movieflix

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import run.velixir.movieflix.data.AdminStats
import run.velixir.movieflix.data.ApiException
import run.velixir.movieflix.data.CardCharge
import run.velixir.movieflix.data.FavoriteRow
import run.velixir.movieflix.data.HistoryRow
import run.velixir.movieflix.data.MovieFlixApi
import run.velixir.movieflix.data.Plan
import run.velixir.movieflix.data.PixCharge
import run.velixir.movieflix.data.PlaybackSource
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
    val pixEnabled: Boolean = false,
    val cardEnabled: Boolean = false,
    val cardPublicKey: String? = null,
    val cardCharge: CardCharge? = null,
    val cardLoading: Boolean = false,
    val cardError: String? = null,
    val pixCharge: PixCharge? = null,
    val pixLoading: Boolean = false,
    val pixError: String? = null,
    val subscription: SubscriptionResponse? = null,
    val loggedIn: Boolean = false,
    val email: String? = null,
    val isAdmin: Boolean = false,
    val seasons: List<Season> = emptyList(),
    val adminStats: AdminStats? = null,
    val adminError: String? = null,
    val toast: String? = null,
)

class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val session = SessionStore(app)
    private val api = MovieFlixApi(BuildConfig.API_BASE_URL, session)

    private val _state = MutableStateFlow(
        UiState(
            loggedIn = session.isLoggedIn,
            email = session.email,
            isAdmin = session.isLoggedIn && session.isAdmin,
        ),
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
                adminStats = null,
                adminError = null,
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
            // Favoritos e Histórico vêm do Supabase e podem apontar para títulos
            // que o provedor não serve mais. A lista de disponibilidade diz o que
            // ainda abre; escondemos o resto sem apagar nada do banco.
            val avail = runCatching { api.availability() }.getOrNull()
            val visibleF = if (avail == null) favs else favs.filter { avail.allows(it.tmdbId, it.mediaType) }
            val visibleH = if (avail == null) hist else hist.filter { avail.allows(it.tmdbId, it.mediaType) }
            update { it.copy(favorites = visibleF, history = visibleH) }
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
            // O Pix depende de MP_ACCESS_TOKEN no servidor. Se não estiver
            // configurado, a tela mantém o botão do WhatsApp.
            val cfg = runCatching { api.pixConfig() }.getOrNull()
            update {
                it.copy(
                    plans = p?.plans ?: emptyList(),
                    pixEnabled = cfg?.pixEnabled == true,
                    cardEnabled = cfg?.cardEnabled == true,
                    cardPublicKey = cfg?.publicKey,
                )
            }
        }
    }

    /**
     * Paga com cartão — tokeniza no Mercado Pago e cobra pelo token.
     *
     * O número e o CVV saem daqui direto para `api.mercadopago.com`; não sobem
     * para o `AppUiState` nem para disco.
     */
    fun payWithCard(
        planCode: String,
        period: String,
        number: String,
        month: Int,
        year: Int,
        cvv: String,
        holder: String,
    ) {
        val pk = _state.value.cardPublicKey
        if (pk.isNullOrBlank()) {
            update { it.copy(cardError = "Pagamento com cartão indisponível no momento.") }
            return
        }
        update { it.copy(cardLoading = true, cardError = null, cardCharge = null) }

        viewModelScope.launch {
            try {
                val tok = api.tokenizeCard(
                    publicKey = pk,
                    cardNumber = number.replace(" ", ""),
                    month = month,
                    year = year,
                    cvv = cvv,
                    holderName = holder,
                )
                val pm = tok.paymentMethodId
                    ?: throw IllegalStateException("Bandeira do cartão não identificada.")

                val charge = api.createCardCharge(
                    planCode = planCode,
                    period = period,
                    token = tok.token,
                    paymentMethodId = pm,
                    issuerId = tok.issuerId,
                )
                update { it.copy(cardCharge = charge, cardLoading = false) }
                if (charge.approved) loadSubscription()
            } catch (e: Exception) {
                update { it.copy(cardLoading = false, cardError = friendlyCard(e)) }
            }
        }
    }

    fun clearCard() =
        update { it.copy(cardCharge = null, cardError = null, cardLoading = false) }

    /** Traduz o erro técnico em uma frase útil para o cliente. */
    private fun friendlyCard(e: Exception): String = when {
        e is ApiException && e.body.contains("card_token_failed") ->
            "Não foi possível validar o cartão. Confira número, validade e CVV."
        e is ApiException && e.body.contains("card_unconfigured") ->
            "Pagamento com cartão indisponível no momento. Use o Pix."
        e is ApiException && e.status == 502 ->
            "O banco não autorizou o pagamento. Tente outro cartão ou use o Pix."
        e.message?.contains("Bandeira") == true -> e.message!!
        else -> "Não foi possível processar o cartão. Tente novamente."
    }

    /**
     * Cria a cobrança Pix do plano/período escolhido.
     *
     * O valor não é enviado: o servidor resolve o preço com a mesma função da
     * tela de planos. O app só recebe o QR e o copia e cola já prontos.
     */
    fun createPix(planCode: String, period: String) {
        update { it.copy(pixLoading = true, pixError = null, pixCharge = null) }
        viewModelScope.launch {
            try {
                val c = api.createPix(planCode, period)
                update { it.copy(pixCharge = c, pixLoading = false) }
            } catch (e: Exception) {
                update { it.copy(pixLoading = false, pixError = friendly(e)) }
            }
        }
    }

    /**
     * Consulta o status do Pix.
     *
     * A tela chama isto em intervalos. Quem ativa é o servidor, depois de
     * consultar a API oficial do Mercado Pago — o app nunca libera acesso.
     */
    fun refreshPixStatus() {
        val id = _state.value.pixCharge?.paymentId ?: return
        if (id.isBlank()) return
        viewModelScope.launch {
            val s = runCatching { api.pixStatus(id) }.getOrNull() ?: return@launch
            update { it.copy(pixCharge = s) }
            if (s.approved) loadSubscription()
        }
    }

    fun clearPix() = update { it.copy(pixCharge = null, pixError = null, pixLoading = false) }

    /**
     * Carrega os números do painel administrativo.
     *
     * Só é chamado quando `isAdmin` é verdadeiro, e mesmo assim o servidor
     * revalida: um 403 aqui significa que a conta perdeu o privilégio, e a
     * tela mostra isso em vez de inventar números.
     */
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
        onResult: (sources: List<PlaybackSource>, message: String?) -> Unit,
    ) {
        if (!session.isLoggedIn) {
            onResult(emptyList(), "Crie sua conta ou entre para assistir.")
            return
        }
        viewModelScope.launch {
            try {
                val r = api.authorizePlayback(tmdbId, season, episode)
                if (r.allowed) {
                    // Cadeia multiprovedor: começa na primeira fonte e avança em
                    // falha real. `source` continua aceito para compatibilidade.
                    val chain = r.sources.ifEmpty {
                        r.source?.let { listOf(it) } ?: emptyList()
                    }
                    onResult(chain, null)
                } else {
                    onResult(emptyList(), r.message ?: "Não foi possível liberar este título.")
                }
            } catch (e: Exception) {
                onResult(emptyList(), friendly(e))
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
