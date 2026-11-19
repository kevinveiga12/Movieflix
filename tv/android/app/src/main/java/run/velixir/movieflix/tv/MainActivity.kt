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
import run.velixir.movieflix.tv.ui.screens.TvPlayerScreen
import run.velixir.movieflix.tv.ui.screens.TvProfilesScreen
import run.velixir.movieflix.tv.ui.screens.TvSearchScreen
import run.velixir.movieflix.tv.ui.screens.TvSettingsScreen
import run.velixir.movieflix.tv.ui.screens.TvSidebar
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MovieFlixTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Gancho de captura: `adb shell am start -n ... --es mf_route plans`.
        val initialRoute = intent?.getStringExtra("mf_route")
        setContent {
            MovieFlixTheme {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(MfColors.Bg),
                ) {
                    MovieFlixTvApp(initialRoute = initialRoute)
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
    data object Account : TvRoute
    data object Profiles : TvRoute
    data object Settings : TvRoute
    data object Admin : TvRoute
    data object Login : TvRoute
    data class Detail(val title: Title) : TvRoute
    data class Player(val title: Title, val season: Int?, val episode: Int?) : TvRoute

    /** Diagnóstico do embed: abre o provedor direto, sem login (só para o CI). */
    data object EmbedDiag : TvRoute
}

@Composable
fun MovieFlixTvApp(vm: TvViewModel = viewModel(), initialRoute: String? = null) {
    var route by remember { mutableStateOf<TvRoute>(TvRoute.Home) }
    val s by vm.state.collectAsState()

    // Rota inicial vinda do intent (captura no CI).
    LaunchedEffect(initialRoute, s.movies.isNotEmpty()) {
        when (initialRoute) {
            "plans" -> route = TvRoute.Plans
            "account" -> route = TvRoute.Account
            "admin" -> route = TvRoute.Admin
            "player" -> s.movies.firstOrNull()?.let { route = TvRoute.Player(it, null, null) }
            "embed" -> route = TvRoute.EmbedDiag
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
            is TvRoute.Player -> TvPlayerScreen(
                vm, r.title, r.season, r.episode,
                onBack = { route = TvRoute.Detail(r.title) },
            )

            TvRoute.EmbedDiag -> Box(Modifier.fillMaxSize()) {
                TvEmbedPlayer("https://myembed.biz/filme/1292035")
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
                        TvRoute.Home -> TvHomeScreen(vm) { route = TvRoute.Detail(it) }
                        TvRoute.Movies -> TvCatalogScreen(vm, "movie") { route = TvRoute.Detail(it) }
                        TvRoute.Series -> TvCatalogScreen(vm, "tv") { route = TvRoute.Detail(it) }
                        TvRoute.Genres -> TvGenresScreen(vm) { route = TvRoute.Detail(it) }
                        TvRoute.Search -> TvSearchScreen(vm) { route = TvRoute.Detail(it) }
                        TvRoute.Favorites -> TvFavoritesScreen(vm) { route = TvRoute.Detail(it) }
                        TvRoute.History -> TvHistoryScreen(vm) { route = TvRoute.Detail(it) }
                        TvRoute.Plans -> TvPlansScreen(vm)
                        TvRoute.Account -> TvAccountScreen(vm) { route = TvRoute.Login }
                        TvRoute.Profiles -> TvProfilesScreen(vm) { route = TvRoute.Login }
                        TvRoute.Settings -> TvSettingsScreen(vm)
                        TvRoute.Admin -> TvAdminScreen(vm)
                        TvRoute.Login -> TvLoginScreen(vm) { route = TvRoute.Account }
                        is TvRoute.Detail -> TvDetailScreen(
                            vm, r.title,
                            onPlay = { season, episode -> route = TvRoute.Player(r.title, season, episode) },
                            onBack = { route = TvRoute.Home },
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
    }
}
