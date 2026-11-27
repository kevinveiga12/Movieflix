package run.velixir.movieflix.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import run.velixir.movieflix.tv.data.Title
import run.velixir.movieflix.tv.ui.screens.TvAccountScreen
import run.velixir.movieflix.tv.ui.screens.TvAdminScreen
import run.velixir.movieflix.tv.ui.screens.TvCatalogScreen
import run.velixir.movieflix.tv.ui.screens.TvDetailScreen
import run.velixir.movieflix.tv.ui.screens.TvEmbedPlayer
import run.velixir.movieflix.tv.ui.screens.TvFavoritesScreen
import run.velixir.movieflix.tv.ui.screens.TvGenresScreen
import run.velixir.movieflix.tv.ui.screens.TvHistoryScreen
import run.velixir.movieflix.tv.ui.screens.TvHomeScreen
import run.velixir.movieflix.tv.ui.screens.TvLoginScreen
import run.velixir.movieflix.tv.ui.screens.TvPlansScreen
import run.velixir.movieflix.tv.ui.screens.TvPixScreen
import run.velixir.movieflix.tv.ui.screens.TvPlayerScreen
import run.velixir.movieflix.tv.ui.screens.TvProfilesScreen
import run.velixir.movieflix.tv.ui.screens.TvSearchScreen
import run.velixir.movieflix.tv.ui.screens.TvSettingsScreen
import run.velixir.movieflix.tv.ui.screens.TvSidebar
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MovieFlixTheme
import run.velixir.movieflix.tv.update.UpdateDialog
import run.velixir.movieflix.tv.update.UpdateManager

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Gancho de captura: `adb shell am start -n ... --es mf_route plans`.
        val initialRoute = intent?.getStringExtra("mf_route")
        // URL opcional para a rota de diagnóstico do player (captura no CI).
        val intentUrl = intent?.getStringExtra("mf_url")
        // Tipo do título na rota de diagnóstico de detalhes (captura no CI).
        val intentSeries = intent?.getStringExtra("mf_type") == "tv"
        setContent {
            MovieFlixTheme {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(MfColors.Bg),
                ) {
                    MovieFlixTvApp(
                        initialRoute = initialRoute,
                        intentUrl = intentUrl,
                        intentSeries = intentSeries,
                    )
                }
            }
        }
    }
}

sealed interface TvRoute {
    data object Home : TvRoute
    data object Movies : TvRoute
    data object Series : TvRoute
    data object Genres : TvRoute
    data object Search : TvRoute
    data object Favorites : TvRoute
    data object History : TvRoute
    data object Plans : TvRoute
    data object Pix : TvRoute
    data object Account : TvRoute
    data object Profiles : TvRoute
    data object Settings : TvRoute
    data object Admin : TvRoute
    data object Login : TvRoute
    data class Detail(val title: Title) : TvRoute
    data class Player(val title: Title, val season: Int?, val episode: Int?) : TvRoute

    /** Diagnóstico do embed: abre o provedor direto, sem login (só para o CI). */
    data class EmbedDiag(val url: String) : TvRoute
}

@Composable
fun MovieFlixTvApp(
    vm: TvViewModel = viewModel(),
    initialRoute: String? = null,
    intentUrl: String? = null,
    intentSeries: Boolean = false,
) {
    var route by remember { mutableStateOf<TvRoute>(TvRoute.Home) }
    val s by vm.state.collectAsState()
    /**
     * Tela do título de onde a pessoa tentou assistir sem estar logada.
     *
     * Depois do login, ela volta para cá em vez de cair no menu de conta — é o
     * que faz o fluxo "sem login → login → assistir" não perder o filme que a
     * pessoa tinha escolhido.
     */
    var afterLogin by remember { mutableStateOf<TvRoute?>(null) }
    // Detalhe pedido pela rota de diagnóstico (captura no CI). O título é
    // resolvido no catálogo e a navegação segue pela rota REAL (TvRoute.Detail),
    // com o menu lateral — igual ao que o usuário vê ao clicar num card.
    var pendingDetail by remember { mutableStateOf<Pair<Long, Boolean>?>(null) }
    // Evita repetir a busca na API a cada recomposição quando o id não está no
    // primeiro lote do catálogo (a rota é só para captura no CI).
    var detailTried by remember { mutableStateOf(false) }

    /*
      ── ATUALIZADOR INTEGRADO (item 12) ──────────────────────────────────────

      Ao abrir o app, consultamos o manifesto de versões. Se houver uma versão
      mais nova, mostramos a janela por cima de tudo.

      A checagem é silenciosa em caso de falha: sem rede, o app abre normalmente
      e o usuário assiste. Nunca bloqueia o catálogo por causa de uma consulta
      de versão.

      `BuildConfig.VERSION_CODE` é o versionCode REAL do APK instalado — é o que
      o Android usa para aceitar (ou recusar) a instalação por cima. Comparar
      por ele evita o bug clássico de "1.0.10 < 1.0.9" em comparação de string.
    */
    var updateManifest by remember { mutableStateOf<UpdateManager.Manifest?>(null) }
    var updateDismissed by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val m = UpdateManager.check(BuildConfig.API_BASE_URL)
        if (UpdateManager.isNewer(m, BuildConfig.VERSION_CODE)) {
            updateManifest = m
        }
    }

    // Rota inicial vinda do intent (captura no CI).
    LaunchedEffect(initialRoute, s.movies.isNotEmpty()) {
        when (initialRoute) {
            "plans" -> route = TvRoute.Plans
            "account" -> route = TvRoute.Account
            "admin" -> route = TvRoute.Admin
            "player" -> s.movies.firstOrNull()?.let { route = TvRoute.Player(it, null, null) }
            "embed" -> route = TvRoute.EmbedDiag(
                intentUrl ?: "https://myembed.biz/filme/1292035",
            )
            "detail" -> {
                val id = intentUrl?.toLongOrNull()
                if (id != null) pendingDetail = id to intentSeries
            }
        }
    }

    // Resolve o detalhe pedido: procura no catálogo em memória; se não achar,
    // busca na API e tenta de novo quando o catálogo crescer.
    LaunchedEffect(pendingDetail, s.movies, s.series) {
        val p = pendingDetail ?: return@LaunchedEffect
        val found = (s.movies + s.series).firstOrNull { it.tmdbId == p.first }
        if (found != null) {
            route = TvRoute.Detail(found)
            pendingDetail = null
        } else if (!detailTried) {
            detailTried = true
            vm.loadTitle(p.first, p.second)
        }
    }

    LaunchedEffect(s.toast) {
        if (s.toast != null) {
            kotlinx.coroutines.delay(2500)
            vm.clearToast()
        }
    }

    // Botão Voltar do controle: sobe um nível, nunca fecha o app de repente.
    Box(
        Modifier
            .fillMaxSize()
            .onKeyEvent { ev ->
                if (ev.type != KeyEventType.KeyDown || ev.key != Key.Back) return@onKeyEvent false
                when (val r = route) {
                    is TvRoute.Player -> { route = TvRoute.Detail(r.title); true }
                    is TvRoute.Detail -> { route = TvRoute.Home; true }
                    TvRoute.Login -> { route = TvRoute.Account; true }
                    TvRoute.Home -> false
                    else -> { route = TvRoute.Home; true }
                }
            },
    ) {
        when (val r = route) {
            is TvRoute.Player -> {
                /*
                  Sem login não existe player.

                  Antes, tentar assistir sem conta abria a tela do player e só
                  depois mostrava "Entre na sua conta para assistir", sem levar a
                  lugar nenhum. Agora cai direto no login, que é exatamente o que o
                  usuário pediu. Depois de entrar, onDone devolve a pessoa à tela
                  do título de onde ela veio (não a um menu qualquer).
                */
                if (!s.loggedIn) {
                    LaunchedEffect(r.title.tmdbId, r.season, r.episode) {
                        // Guarda o PLAYER (não a tela do título): depois de entrar,
                        // a pessoa cai direto no filme que escolheu, tocando.
                        afterLogin = TvRoute.Player(r.title, r.season, r.episode)
                        route = TvRoute.Login
                    }
                } else {
                    TvPlayerScreen(
                        vm, r.title, r.season, r.episode,
                        onBack = { route = TvRoute.Detail(r.title) },
                        // Sessão caiu com o player aberto (token expirado, logout
                        // em outro aparelho): sai do player e vai ao login, e
                        // depois de entrar volta direto ao filme.
                        onLoginRequired = {
                            afterLogin = TvRoute.Player(r.title, r.season, r.episode)
                            route = TvRoute.Login
                        },
                        /*
                          TROCA DE EPISÓDIO (botões anterior/próximo e avanço
                          automático).

                          O player só PEDE a troca; quem navega é esta tela, que
                          já é dona da rota. `replace` não existe aqui — a pilha
                          é uma variável só, então a troca simplesmente substitui
                          a rota atual, sem empilhar telas.
                        */
                        onEpisodeChange = { s, e ->
                            route = TvRoute.Player(r.title, s, e)
                        },
                    )
                }
            }

            is TvRoute.EmbedDiag -> Box(Modifier.fillMaxSize()) {
                TvEmbedPlayer(r.url, onBack = { route = TvRoute.Home })
            }

            else -> Row(Modifier.fillMaxSize()) {
                val currentKey = when (r) {
                    TvRoute.Home -> "home"
                    TvRoute.Movies -> "movies"
                    TvRoute.Series -> "series"
                    TvRoute.Genres -> "genres"
                    TvRoute.Search -> "search"
                    TvRoute.Favorites -> "favorites"
                    TvRoute.History -> "history"
                    TvRoute.Plans -> "plans"
                    TvRoute.Account, TvRoute.Login -> "account"
                    TvRoute.Profiles -> "profiles"
                    TvRoute.Settings -> "settings"
                    TvRoute.Admin -> "admin"
                    is TvRoute.Detail -> "home"
                    else -> "home"
                }

                TvSidebar(currentKey, { key ->
                    route = when (key) {
                        "movies" -> TvRoute.Movies
                        "series" -> TvRoute.Series
                        "genres" -> TvRoute.Genres
                        "search" -> TvRoute.Search
                        "favorites" -> TvRoute.Favorites
                        "history" -> TvRoute.History
                        "plans" -> TvRoute.Plans
                        "profiles" -> if (s.loggedIn) TvRoute.Profiles else TvRoute.Login
                        "settings" -> TvRoute.Settings
                        "admin" -> TvRoute.Admin
                        "account" -> if (s.loggedIn) TvRoute.Account else TvRoute.Login
                        else -> TvRoute.Home
                    }
                }, s.email, s.isAdmin)

                Box(Modifier.weight(1f)) {
                    when (r) {
                        TvRoute.Home -> TvHomeScreen(
                            vm,
                            onOpen = { route = TvRoute.Detail(it) },
                            onLoginRequired = {
                                // Assistir sem sessão → login imediato.
                                afterLogin = TvRoute.Home
                                route = TvRoute.Login
                            },
                        )
                        TvRoute.Movies -> TvCatalogScreen(vm, "movie") { route = TvRoute.Detail(it) }
                        TvRoute.Series -> TvCatalogScreen(vm, "tv") { route = TvRoute.Detail(it) }
                        TvRoute.Genres -> TvGenresScreen(vm) { route = TvRoute.Detail(it) }
                        TvRoute.Search -> TvSearchScreen(vm) { route = TvRoute.Detail(it) }
                        TvRoute.Favorites -> TvFavoritesScreen(vm) { route = TvRoute.Detail(it) }
                        TvRoute.History -> TvHistoryScreen(vm) { route = TvRoute.Detail(it) }
                        TvRoute.Plans -> TvPlansScreen(vm) { route = TvRoute.Pix }
                        TvRoute.Pix -> TvPixScreen(vm) { route = TvRoute.Plans }
                        TvRoute.Account -> TvAccountScreen(vm) { route = TvRoute.Login }
                        TvRoute.Profiles -> TvProfilesScreen(vm) { route = TvRoute.Login }
                        TvRoute.Settings -> TvSettingsScreen(vm)
                        TvRoute.Admin -> TvAdminScreen(vm)
                        TvRoute.Login -> TvLoginScreen(vm) {
                            // Volta para o título de onde veio, quando houve
                            // tentativa de assistir sem sessão.
                            route = afterLogin ?: TvRoute.Account
                            afterLogin = null
                        }
                        is TvRoute.Detail -> TvDetailScreen(
                            vm, r.title,
                            onPlay = { season, episode ->
                                if (s.loggedIn) {
                                    route = TvRoute.Player(r.title, season, episode)
                                } else {
                                    // Sem sessão o botão "Assistir" leva ao login,
                                    // e não ao player. Depois de entrar, volta
                                    // DIRETO ao player do título escolhido.
                                    afterLogin = TvRoute.Player(r.title, season, episode)
                                    route = TvRoute.Login
                                }
                            },
                            onBack = { route = TvRoute.Home },
                            onOpen = { route = TvRoute.Detail(it) },
                        )
                        else -> {}
                    }

                    if (s.toast != null) {
                        Box(
                            Modifier
                                .align(Alignment.BottomCenter)
                                .padding(24.dp)
                                .background(MfColors.BgHover, RoundedCornerShape(10.dp))
                                .padding(horizontal = 20.dp, vertical = 12.dp),
                        ) {
                            Text(s.toast!!, color = MfColors.Text, fontSize = 14.sp)
                        }
                    }
                }
            }
        }

        /*
          A janela de atualização fica ACIMA de qualquer rota — inclusive do
          player. Se o usuário estiver assistindo quando a checagem termina, a
          janela aparece por cima; ele pode adiar (quando opcional) e continuar.
        */
        val m = updateManifest
        if (m != null && !updateDismissed) {
            UpdateDialog(
                manifest = m,
                installedVersion = BuildConfig.VERSION_NAME,
                onDismiss = { updateDismissed = true },
            )
        }
    }
}
