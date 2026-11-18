package run.velixir.movieflix

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import run.velixir.movieflix.data.Title
import run.velixir.movieflix.ui.screens.AccountScreen
import run.velixir.movieflix.ui.screens.CatalogScreen
import run.velixir.movieflix.ui.screens.DetailScreen
import run.velixir.movieflix.ui.screens.FavoritesScreen
import run.velixir.movieflix.ui.screens.ForgotScreen
import run.velixir.movieflix.ui.screens.HistoryScreen
import run.velixir.movieflix.ui.screens.HomeScreen
import run.velixir.movieflix.ui.screens.LoginScreen
import run.velixir.movieflix.ui.screens.PlansScreen
import run.velixir.movieflix.ui.screens.PlayerScreen
import run.velixir.movieflix.ui.screens.SearchScreen
import run.velixir.movieflix.ui.screens.SignupScreen
import run.velixir.movieflix.ui.theme.MfColors
import run.velixir.movieflix.ui.theme.MovieFlixTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MovieFlixTheme {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(MfColors.Bg)
                        .statusBarsPadding(),
                ) {
                    MovieFlixApp()
                }
            }
        }
    }
}

/** Rotas do app. Navegação própria, sem depender de URL. */
sealed interface Route {
    data object Home : Route
    data object Movies : Route
    data object Series : Route
    data object Search : Route
    data object Favorites : Route
    data object History : Route
    data object Account : Route
    data object Plans : Route
    data object Login : Route
    data object Signup : Route
    data object Forgot : Route
    data class Detail(val title: Title) : Route
    data class Player(val title: Title, val season: Int?, val episode: Int?) : Route
}

@Composable
fun MovieFlixApp(vm: AppViewModel = viewModel()) {
    var route by remember { mutableStateOf<Route>(Route.Home) }
    val s by vm.state.collectAsState()

    // Toast curto para ações (favorito salvo, erro de rede).
    androidx.compose.runtime.LaunchedEffect(s.toast) {
        if (s.toast != null) {
            kotlinx.coroutines.delay(2500)
            vm.clearToast()
        }
    }

    val showTabs = route !is Route.Player && route !is Route.Login &&
        route !is Route.Signup && route !is Route.Forgot

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            when (val r = route) {
                Route.Home -> HomeScreen(vm, { route = Route.Detail(it) }, { route = Route.Search })
                Route.Movies -> CatalogScreen(vm, "movie") { route = Route.Detail(it) }
                Route.Series -> CatalogScreen(vm, "tv") { route = Route.Detail(it) }
                Route.Search -> SearchScreen(vm) { route = Route.Detail(it) }
                Route.Favorites -> FavoritesScreen(vm) { route = Route.Detail(it) }
                Route.History -> HistoryScreen(vm) { route = Route.Detail(it) }
                Route.Account -> AccountScreen(
                    vm,
                    onLogin = { route = Route.Login },
                    onPlans = { route = Route.Plans },
                )
                Route.Plans -> PlansScreen(vm)
                Route.Login -> LoginScreen(
                    vm,
                    onDone = { route = Route.Home },
                    onSignup = { route = Route.Signup },
                    onForgot = { route = Route.Forgot },
                )
                Route.Signup -> SignupScreen(
                    vm,
                    onDone = { route = Route.Login },
                    onBack = { route = Route.Login },
                )
                Route.Forgot -> ForgotScreen(vm) { route = Route.Login }
                is Route.Detail -> DetailScreen(
                    vm,
                    r.title,
                    onPlay = { season, episode -> route = Route.Player(r.title, season, episode) },
                    onBack = { route = Route.Home },
                )
                is Route.Player -> PlayerScreen(
                    vm,
                    r.title,
                    r.season,
                    r.episode,
                    onBack = { route = Route.Detail(r.title) },
                )
            }

            if (s.toast != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp)
                        .background(MfColors.BgHover, androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                ) {
                    Text(s.toast!!, color = MfColors.Text, fontSize = 13.sp)
                }
            }
        }

        if (showTabs) {
            BottomBar(route) { route = it }
        }
    }
}

@Composable
private fun BottomBar(current: Route, onSelect: (Route) -> Unit) {
    val items = listOf(
        Triple("Início", Icons.Default.Home, Route.Home),
        Triple("Filmes", Icons.Default.Movie, Route.Movies),
        Triple("Séries", Icons.Default.Tv, Route.Series),
        Triple("Favoritos", Icons.Default.Favorite, Route.Favorites),
        Triple("Conta", Icons.Default.AccountCircle, Route.Account),
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MfColors.BgElev)
            .navigationBarsPadding()
            .padding(vertical = 8.dp),
    ) {
        items.forEach { (label, icon, target) ->
            val active = current::class == target::class
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onSelect(target) }
                    .padding(vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(
                    icon,
                    contentDescription = label,
                    tint = if (active) MfColors.Red else MfColors.TextDim,
                )
                Text(
                    label,
                    color = if (active) MfColors.Red else MfColors.TextDim,
                    fontSize = 10.sp,
                    fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
                )
            }
        }
    }
}
