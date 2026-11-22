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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import run.velixir.movieflix.data.Title
import run.velixir.movieflix.ui.screens.AccountScreen
import run.velixir.movieflix.ui.screens.AdminScreen
import run.velixir.movieflix.ui.screens.CatalogScreen
import run.velixir.movieflix.ui.screens.DetailScreen
import run.velixir.movieflix.ui.screens.EmbedPlayer
import run.velixir.movieflix.ui.screens.FavoritesScreen
import run.velixir.movieflix.ui.screens.ForgotScreen
import run.velixir.movieflix.ui.screens.GenresScreen
import run.velixir.movieflix.ui.screens.HistoryScreen
import run.velixir.movieflix.ui.screens.HomeScreen
import run.velixir.movieflix.ui.screens.LoginScreen
import run.velixir.movieflix.ui.screens.PlansScreen
import run.velixir.movieflix.ui.screens.PlayerScreen
import run.velixir.movieflix.ui.screens.ProfilesScreen
import run.velixir.movieflix.ui.screens.SearchScreen
import run.velixir.movieflix.ui.screens.SettingsScreen
import run.velixir.movieflix.ui.screens.SignupScreen
import run.velixir.movieflix.ui.theme.MfColors
import run.velixir.movieflix.ui.theme.MovieFlixTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Gancho de captura: `adb shell am start -n ... --es mf_route plans`
        // abre direto uma tela. Serve para o emulador do CI fotografar telas
        // que exigem login ou varios toques. Sem o extra, o app abre normal.
        val initialRoute = intent?.getStringExtra("mf_route")
        setContent {
            MovieFlixTheme {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(MfColors.Bg)
                        .statusBarsPadding(),
                ) {
                    MovieFlixRoot(initialRoute = initialRoute)
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
    data object Genres : Route
    data object Search : Route
    data object Favorites : Route
    data object History : Route
    data object Account : Route
    data object Profiles : Route
    data object Settings : Route
    data object Plans : Route
    data object Admin : Route
    data object Login : Route
    data object Signup : Route
    data object Forgot : Route
    data class Detail(val title: Title) : Route
    data class Player(val title: Title, val season: Int?, val episode: Int?) : Route

    /**
     * Diagnóstico do embed: abre o provedor direto, sem login.
     *
     * Existe só para o CI comprovar que o WebView entrega o player (e não a
     * página de cloaking). Não aparece em nenhum menu e não libera conteúdo:
     * é a mesma URL pública que o site incorpora.
     */
    data object EmbedDiag : Route
}

/**
 * Raiz da interface.
 *
 * ATENÇÃO ao nome: esta função NÃO pode se chamar `MovieFlixApp`, porque já
 * existe `class MovieFlixApp : Application()` no mesmo pacote. Com o nome
 * repetido, a chamada `MovieFlixApp()` dentro de `setContent` resolvia para o
 * CONSTRUTOR da classe Application em vez desta função — compilava sem erro,
 * mas não montava interface nenhuma. O R8 então via esta função como não usada
 * e removia junto todo o pacote `ui`, o Compose, o Coil e o OkHttp: o APK
 * abria em tela preta. Nome distinto elimina a ambiguidade.
 */
@Composable
fun MovieFlixRoot(vm: AppViewModel = viewModel(), initialRoute: String? = null) {
    var route by remember { mutableStateOf<Route>(Route.Home) }
    val s by vm.state.collectAsState()

    // Rota inicial vinda do intent (captura no CI). "player" usa o primeiro
    // filme do catálogo, para a tela do player ser fotografada de verdade.
    androidx.compose.runtime.LaunchedEffect(initialRoute, s.movies.isNotEmpty()) {
        when (initialRoute) {
            "plans" -> route = Route.Plans
            "account" -> route = Route.Account
            "admin" -> route = Route.Admin
            "player" -> s.movies.firstOrNull()?.let { route = Route.Player(it, null, null) }
            "embed" -> route = Route.EmbedDiag
        }
    }

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
                Route.Home -> HomeScreen(
                    vm,
                    onOpen = { route = Route.Detail(it) },
                    onSearch = { route = Route.Search },
                    onGenres = { route = Route.Genres },
                )
                Route.Movies -> CatalogScreen(vm, "movie", { route = Route.Detail(it) }) {
                    route = Route.Search
                }
                Route.Series -> CatalogScreen(vm, "tv", { route = Route.Detail(it) }) {
                    route = Route.Search
                }
                Route.Genres -> GenresScreen(vm, { route = Route.Detail(it) }) {
                    route = Route.Search
                }
                Route.Search -> SearchScreen(vm) { route = Route.Detail(it) }
                Route.Favorites -> FavoritesScreen(vm, { route = Route.Detail(it) }) {
                    route = Route.Search
                }
                Route.History -> HistoryScreen(vm, { route = Route.Detail(it) }) {
                    route = Route.Search
                }
                Route.Account -> AccountScreen(
                    vm,
                    onLogin = { route = Route.Login },
                    onPlans = { route = Route.Plans },
                    onFavorites = { route = Route.Favorites },
                    onHistory = { route = Route.History },
                    onSettings = { route = Route.Settings },
                    onProfiles = { route = Route.Profiles },
                    onAdmin = { route = Route.Admin },
                )
                Route.Profiles -> ProfilesScreen(vm) { route = Route.Account }
                Route.Settings -> SettingsScreen(vm) { route = Route.Account }
                Route.Plans -> PlansScreen(vm)
                Route.Admin -> AdminScreen(vm) { route = Route.Account }
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
                Route.EmbedDiag -> Box(Modifier.fillMaxSize()) {
                    // Diagnóstico do embed. Aponta para o provedor atual (MegaEmbed).
                    EmbedPlayer("https://mgeb.space/embed/1292035")
                }
            }

            if (s.toast != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp)
                        .background(MfColors.BgHover, RoundedCornerShape(10.dp))
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

/**
 * Barra inferior — as cinco abas principais do site.
 *
 * Início · Filmes · Séries · Buscar · Conta
 *
 * Favoritos, histórico, perfis, configurações e planos ficam dentro de Conta,
 * como no site (o menu do usuário). A aba ativa é vermelha, com o rótulo em
 * negrito — o mesmo destaque do `.nav-link.active` do site.
 */
@Composable
private fun BottomBar(current: Route, onSelect: (Route) -> Unit) {
    val items = listOf(
        Triple("Início", Icons.Default.Home, Route.Home),
        Triple("Filmes", Icons.Default.Movie, Route.Movies),
        Triple("Séries", Icons.Default.Tv, Route.Series),
        Triple("Buscar", Icons.Default.Search, Route.Search),
        Triple("Conta", Icons.Default.AccountCircle, Route.Account),
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MfColors.BgElev)
            .navigationBarsPadding()
            .padding(vertical = 7.dp),
    ) {
        items.forEach { (label, icon, target) ->
            val active = when (target) {
                Route.Home -> current is Route.Home
                Route.Movies -> current is Route.Movies
                Route.Series -> current is Route.Series
                Route.Search -> current is Route.Search
                Route.Account -> current is Route.Account || current is Route.Profiles ||
                    current is Route.Settings || current is Route.Plans ||
                    current is Route.Admin ||
                    current is Route.Favorites || current is Route.History
                else -> false
            }
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onSelect(target) }
                    .padding(vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    modifier = Modifier
                        .size(width = 40.dp, height = 26.dp)
                        .clip(RoundedCornerShape(13.dp))
                        .background(if (active) MfColors.Red.copy(alpha = 0.16f) else Color.Transparent),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        icon,
                        contentDescription = label,
                        tint = if (active) MfColors.Red else MfColors.TextDim,
                        modifier = Modifier.size(20.dp),
                    )
                }
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
