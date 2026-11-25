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
import run.velixir.movieflix.tv.data.PixCharge
import run.velixir.movieflix.tv.data.PlaybackSource
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
    val related: List<Title> = emptyList(),
    val genres: List<String> = emptyList(),
    val plans: List<Plan> = emptyList(),
    val pixEnabled: Boolean = false,
    val pixCharge: PixCharge? = null,
    val pixLoading: Boolean = false,
    val pixError: String? = null,
    val subscription: SubscriptionResponse? = null,
    val loggedIn: Boolean = false,
    val email: String? = null,
    val isAdmin: Boolean = false,
    val adminStats: AdminStats? = null,
    val adminError: String? = null,
    val toast: String? = null,
    /**
     * Paginação do catálogo (item 3).
     *
     * `total` é o que o servidor diz existir para o filtro atual; `hasMore`
     * compara o que já está em memória com esse total. `loadingMore` é separado
     * de `loading` de propósito: o indicador discreto do rodapé não pode
     * substituir a grade inteira por um spinner.
     */
    val catalogTotal: Int = 0,
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    /** Semente da sessão — mantém a ordem estável entre páginas. */
    val seed: String = "",
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
            // Semente da sessão: a ordem do catálogo fica estável enquanto a
            // pessoa navega e muda por completo no próximo acesso.
            seed = newSeed(),
        ),
    )
    val state: StateFlow<TvState> = _state.asStateFlow()

    /**
     * Estado da paginação por tipo de catálogo.
     *
     * Fica fora do `TvState` porque é controle interno: a UI só precisa saber
     * `hasMore` e `loadingMore`. Guardar aqui evita que uma recomposição
     * dispare uma segunda busca da mesma página.
     */
    private data class PageCursor(
        val kind: String,
        val genre: String?,
        val offset: Int,
        val total: Int,
        val loading: Boolean,
    )

    private var cursor: PageCursor? = null

    /** Tamanho de cada bloco. 60 é o que o servidor devolve por padrão. */
    private val pageSize = 60

    private fun newSeed(): String =
        "${System.currentTimeMillis().toString(36)}-${(0..0xFFFFFF).random().toString(36)}"

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
                val seed = _state.value.seed
                val m = api.movies(limit = 40, seed = seed)
                val s = api.series(limit = 40, seed = seed)
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

    /**
     * Carrega a PRIMEIRA página de um catálogo (Filmes ou Séries).
     *
     * Substitui a lista e reinicia o cursor. Chamado ao entrar na tela e ao
     * trocar de gênero.
     */
    fun loadCatalog(kind: String, genre: String? = null) {
        cursor = PageCursor(kind = kind, genre = genre, offset = 0, total = 0, loading = true)
        viewModelScope.launch {
            update { it.copy(loading = true, error = null, loadingMore = false) }
            try {
                val seed = _state.value.seed
                val r = if (kind == "tv") api.series(limit = pageSize, offset = 0, genre = genre, seed = seed)
                else api.movies(limit = pageSize, offset = 0, genre = genre, seed = seed)

                cursor = PageCursor(
                    kind = kind,
                    genre = genre,
                    offset = r.items.size,
                    total = r.total,
                    loading = false,
                )
                update {
                    it.copy(
                        loading = false,
                        movies = if (kind == "tv") it.movies else r.items,
                        series = if (kind == "tv") r.items else it.series,
                        catalogTotal = r.total,
                        hasMore = r.items.size < r.total,
                    )
                }
            } catch (e: Exception) {
                cursor = null
                update { it.copy(loading = false, error = friendly(e), hasMore = false) }
            }
        }
    }

    /**
     * Carrega o PRÓXIMO bloco do catálogo atual (item 3 — carregamento
     * automático).
     *
     * Regras que evitam os problemas clássicos de scroll infinito:
     *
     *  • Uma requisição por vez: se `cursor.loading` já é verdadeiro, sai. Sem
     *    isso, o LazyGrid dispara vários pedidos ao chegar perto do fim e a
     *    mesma página é buscada 3–4 vezes.
     *  • Sem duplicatas: os itens novos são filtrados por `tmdb_id` contra o que
     *    já está em memória. Mesmo que o servidor devolva um item repetido (por
     *    causa de uma alteração no catálogo entre páginas), ele não aparece
     *    duas vezes.
     *  • Sem buracos: o offset avança pelo tamanho REAL recebido, não pelo
     *    tamanho pedido. Se o servidor devolver menos que `pageSize`, a próxima
     *    chamada continua de onde parou.
     *  • Para no fim: quando o que está em memória alcança `total`, `hasMore`
     *    vira falso e a UI para de pedir.
     */
    fun loadMore() {
        val c = cursor ?: return
        if (c.loading) return
        val current = _state.value
        val loaded = if (c.kind == "tv") current.series.size else current.movies.size
        if (loaded >= c.total && c.total > 0) {
            update { it.copy(hasMore = false) }
            return
        }

        cursor = c.copy(loading = true)
        update { it.copy(loadingMore = true) }

        viewModelScope.launch {
            try {
                val seed = _state.value.seed
                val r = if (c.kind == "tv")
                    api.series(limit = pageSize, offset = c.offset, genre = c.genre, seed = seed)
                else
                    api.movies(limit = pageSize, offset = c.offset, genre = c.genre, seed = seed)

                update { st ->
                    val existing = if (c.kind == "tv") st.series else st.movies
                    val seen = existing.map { it.tmdbId }.toHashSet()
                    val fresh = r.items.filter { seen.add(it.tmdbId) }
                    val merged = existing + fresh
                    st.copy(
                        series = if (c.kind == "tv") merged else st.series,
                        movies = if (c.kind == "tv") st.movies else merged,
                        catalogTotal = r.total,
                        hasMore = merged.size < r.total,
                        loadingMore = false,
                    )
                }

                cursor = c.copy(
                    offset = c.offset + r.items.size,
                    total = r.total,
                    loading = false,
                )
            } catch (e: Exception) {
                cursor = c.copy(loading = false)
                update { it.copy(loadingMore = false, toast = friendly(e)) }
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

    /**
     * Carrega um título pelo tmdb_id e o coloca no catálogo em memória.
     *
     * Usado pela rota de diagnóstico `mf_route detail` (captura no CI), que
     * precisa abrir a tela de detalhes de um id específico sem navegar pela
     * home. A busca usa o `q` do catálogo e casa pelo tmdb_id exato.
     */
    fun loadTitle(tmdbId: Long, isSeries: Boolean) {
        viewModelScope.launch {
            val r = runCatching {
                if (isSeries) api.series(limit = 200) else api.movies(limit = 200)
            }.getOrNull()
            val hit = r?.items?.firstOrNull { it.tmdbId == tmdbId } ?: return@launch
            update {
                if (isSeries) it.copy(series = (it.series + hit).distinctBy { t -> t.tmdbId })
                else it.copy(movies = (it.movies + hit).distinctBy { t -> t.tmdbId })
            }
        }
    }

    /**
     * Títulos relacionados — o mesmo critério de `relatedTo()` em
     * src/lib/catalog.ts: mesmo tipo (filme com filme, série com série) e
     * mesma categoria, ordenado por popularidade.
     *
     * A API não tem endpoint de relacionados, então a busca usa o filtro
     * `genre` com o primeiro termo da categoria (o catálogo guarda categorias
     * compostas, tipo "Ação, Animação, Família") e depois ordena no cliente
     * pondo na frente quem tem a categoria idêntica à do título aberto — que
     * é exatamente o que o site faz. Máximo de 20 cards.
     */
    fun loadRelated(t: Title) {
        viewModelScope.launch {
            update { it.copy(related = emptyList()) }
            val firstGenre = t.category
                .split(",")
                .map { it.trim() }
                .firstOrNull { it.isNotBlank() }
            val pool = runCatching {
                if (t.isSeries) api.series(limit = 60, genre = firstGenre)
                else api.movies(limit = 60, genre = firstGenre)
            }.getOrNull()?.items ?: emptyList()

            val out = pool
                .filter { it.tmdbId != t.tmdbId }
                .sortedWith(
                    compareByDescending<Title> {
                        it.category.trim().equals(t.category.trim(), ignoreCase = true)
                    }.thenByDescending { it.popularity },
                )
                .take(20)
            update { it.copy(related = out) }
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
            // Favoritos e Histórico vêm do Supabase e podem apontar para títulos
            // que o provedor não serve mais. A lista de disponibilidade diz o que
            // ainda abre; escondemos o resto sem apagar nada do banco.
            val avail = runCatching { api.availability() }.getOrNull()
            val visibleF = if (avail == null) f else f.filter { avail.allows(it.tmdbId, it.mediaType) }
            val visibleH = if (avail == null) h else h.filter { avail.allows(it.tmdbId, it.mediaType) }
            update { it.copy(favorites = visibleF, history = visibleH) }
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
            // O Pix depende de MP_ACCESS_TOKEN no servidor. Sem ele, a tela
            // mantém o QR do WhatsApp — melhor vender pelo caminho que
            // funciona do que mostrar um botão que dá erro.
            val cfg = runCatching { api.pixConfig() }.getOrNull()
            update {
                it.copy(
                    plans = p?.plans ?: emptyList(),
                    pixEnabled = cfg?.pixEnabled == true,
                )
            }
        }
    }

    /**
     * Cria a cobrança Pix do plano/período escolhido.
     *
     * O valor não é enviado: o servidor resolve o preço com a mesma função da
     * tela de planos. A TV só recebe o QR e o copia e cola já prontos.
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
     * Quem ativa é o servidor, depois de consultar a API oficial do Mercado
     * Pago. A TV só reflete o que ele respondeu — e, ao aprovar, recarrega a
     * assinatura para o acesso valer sem reinstalar nem cadastrar de novo.
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
        onResult: (List<PlaybackSource>, String?, String?) -> Unit,
    ) {
        if (!session.isLoggedIn) {
            // Sem sessão: NÃO é erro de reprodução — é falta de login. O 3º
            // argumento ("unauthenticated") faz a tela mandar ao login em vez
            // de mostrar a mensagem com "Voltar".
            onResult(emptyList(), "Entre na sua conta para assistir.", "unauthenticated")
            return
        }
        viewModelScope.launch {
            try {
                val r = api.authorizePlayback(tmdbId, season, episode)
                if (r.allowed) {
                    // Cadeia multiprovedor: o servidor devolve TODAS as fontes
                    // em ordem. O app começa na primeira e avança em falha real.
                    val chain = r.sources.ifEmpty {
                        r.source?.let { listOf(it) } ?: emptyList()
                    }
                    onResult(chain, null, null)
                } else {
                    onResult(emptyList(), r.message ?: "Não foi possível liberar este título.", r.reason)
                }
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
                    onResult(emptyList(), friendly(e), "unauthenticated")
                    return@launch
                }
                onResult(emptyList(), friendly(e), null)
            }
        }
    }

    /**
     * Onde este filme parou, em segundos, para a TV retomar de lá.
     *
     * Lê do `history` que já está em memória (mesma consulta que alimenta a
     * fileira "Continuar assistindo") — nenhuma requisição nova ao abrir o
     * player, nenhuma tabela ou campo novo.
     *
     * Devolve 0 quando não há registro ou quando o filme já está no fim: nos
     * últimos 30 s ou acima de 95% do total, começar do início é o
     * comportamento esperado, não voltar para os créditos.
     */
    fun resumePositionFor(tmdbId: Long): Double {
        val row = _state.value.history.firstOrNull {
            it.tmdbId == tmdbId && it.mediaType != "tv" && it.episodeId.isNullOrBlank()
        } ?: return 0.0
        val pos = row.positionSeconds
        val dur = row.durationSeconds
        if (pos <= 5) return 0.0
        if (dur > 0 && (dur - pos < 30 || pos / dur > 0.95)) return 0.0
        return pos
    }

    /**
     * Onde ESTE EPISÓDIO parou, em segundos, para a TV retomar de lá.
     *
     * ── POR QUE ISTO EXISTE ──────────────────────────────────────────────────
     *
     * A tela já GRAVAVA o progresso do episódio (`saveProgress` com
     * `episodeId = "T/E"`), mas nunca lia de volta: `resumePositionFor` só
     * aceitava filme (`mediaType != "tv"` e `episodeId` vazio). Resultado: quem
     * saía no minuto 20 de um episódio voltava ao segundo 0 — o item 9 do
     * pedido ("retomada de episódios na Android TV") não estava cumprido.
     *
     * A chave é o par temporada/episódio, exatamente o mesmo formato que o
     * `saveProgress` grava. Sem isso, dois episódios da mesma série
     * compartilhariam a posição — o que o pedido proíbe explicitamente.
     *
     * Mesma regra de borda do filme: nos últimos 30 s ou acima de 95% do
     * total, começar do início é o esperado (não voltar para os créditos).
     */
    fun resumePositionForEpisode(tmdbId: Long, season: Int, episode: Int): Double {
        val key = "$season/$episode"
        val row = _state.value.history.firstOrNull {
            it.tmdbId == tmdbId && it.episodeId == key
        } ?: return 0.0
        val pos = row.positionSeconds
        val dur = row.durationSeconds
        if (pos <= 5) return 0.0
        if (dur > 0 && (dur - pos < 30 || pos / dur > 0.95)) return 0.0
        return pos
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
