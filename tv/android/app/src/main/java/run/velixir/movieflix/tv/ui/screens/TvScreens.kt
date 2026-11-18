package run.velixir.movieflix.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import run.velixir.movieflix.tv.TvViewModel
import run.velixir.movieflix.tv.data.Title
import run.velixir.movieflix.tv.ui.theme.MfColors

@Composable
fun TvHomeScreen(vm: TvViewModel, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()

    when {
        s.loading && s.movies.isEmpty() -> TvLoading()
        s.error != null && s.movies.isEmpty() -> TvError(s.error!!) { vm.loadHome() }
        else -> LazyColumn(Modifier.fillMaxSize()) {
            item { TvHero(s.movies.firstOrNull()) { s.movies.firstOrNull()?.let(onOpen) } }
            item { TvRow("Filmes", s.movies) { onOpen(it) } }
            item { TvRow("Séries", s.series) { onOpen(it) } }
            if (s.history.isNotEmpty()) {
                item {
                    Column(Modifier.padding(bottom = 22.dp)) {
                        Text(
                            "Continuar assistindo",
                            color = MfColors.Text,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Black,
                            modifier = Modifier.padding(start = 48.dp, bottom = 12.dp),
                        )
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 48.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            items(s.history) { h ->
                                var focused by remember { mutableStateOf(false) }
                                Column(
                                    modifier = Modifier
                                        .width(200.dp)
                                        .onFocusChanged { focused = it.isFocused }
                                        .clickable {
                                            onOpen(
                                                Title(
                                                    id = h.tmdbId.toString(),
                                                    title = h.title,
                                                    posterUrl = h.posterUrl,
                                                    tmdbId = h.tmdbId,
                                                    type = h.mediaType,
                                                    mediaType = h.mediaType,
                                                ),
                                            )
                                        }
                                        .padding(4.dp),
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(112.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(MfColors.BgCard)
                                            .then(
                                                if (focused) Modifier.border(3.dp, MfColors.Red, RoundedCornerShape(8.dp))
                                                else Modifier,
                                            ),
                                    ) {
                                        AsyncImage(
                                            model = h.posterUrl,
                                            contentDescription = h.title,
                                            contentScale = ContentScale.Crop,
                                            modifier = Modifier.fillMaxSize(),
                                        )
                                        Box(
                                            Modifier
                                                .align(Alignment.BottomStart)
                                                .fillMaxWidth()
                                                .height(4.dp)
                                                .background(MfColors.BgHover),
                                        ) {
                                            Box(
                                                Modifier
                                                    .fillMaxWidth(h.progress.toFloat().coerceIn(0f, 1f))
                                                    .height(4.dp)
                                                    .background(MfColors.Red),
                                            )
                                        }
                                    }
                                    Spacer(Modifier.height(6.dp))
                                    Text(h.title, color = MfColors.TextMuted, fontSize = 12.sp, maxLines = 1)
                                }
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(30.dp)) }
        }
    }
}

@Composable
fun TvCatalogScreen(vm: TvViewModel, kind: String, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()
    val items = if (kind == "tv") s.series else s.movies

    Column(Modifier.fillMaxSize()) {
        Text(
            if (kind == "tv") "Séries" else "Filmes",
            color = MfColors.Text,
            fontSize = 26.sp,
            fontWeight = FontWeight.Black,
            modifier = Modifier.padding(start = 48.dp, top = 28.dp, bottom = 16.dp),
        )
        when {
            s.loading && items.isEmpty() -> TvLoading()
            items.isEmpty() -> TvEmpty("Nada por aqui ainda.")
            else -> androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
                columns = androidx.compose.foundation.lazy.grid.GridCells.Adaptive(minSize = 150.dp),
                contentPadding = PaddingValues(horizontal = 48.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                items(items.size, key = { "${items[it].type}-${items[it].tmdbId}" }) { i ->
                    TvPosterCard(items[i], { onOpen(items[i]) }, width = 200)
                }
            }
        }
    }
}

@Composable
fun TvSearchScreen(vm: TvViewModel, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()
    var term by remember { mutableStateOf("") }
    val focus = remember { FocusRequester() }

    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = term,
            onValueChange = {
                term = it
                vm.search(it)
            },
            placeholder = { Text("Buscar filmes e séries", color = MfColors.TextDim) },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 48.dp, vertical = 24.dp)
                .focusRequester(focus),
        )
        when {
            term.isBlank() -> TvEmpty("Digite para buscar no catálogo.")
            s.loading -> TvLoading()
            s.searchResults.isEmpty() -> TvEmpty("Nenhum resultado para \"$term\".")
            else -> androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
                columns = androidx.compose.foundation.lazy.grid.GridCells.Adaptive(minSize = 150.dp),
                contentPadding = PaddingValues(horizontal = 48.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                items(s.searchResults.size, key = { "${s.searchResults[it].type}-${s.searchResults[it].tmdbId}" }) { i ->
                    TvPosterCard(s.searchResults[i], { onOpen(s.searchResults[i]) }, width = 200)
                }
            }
        }
    }
}

@Composable
fun TvFavoritesScreen(vm: TvViewModel, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()

    if (!s.loggedIn) {
        TvEmpty("Entre na sua conta para ver seus favoritos.")
        return
    }
    if (s.favorites.isEmpty()) {
        TvEmpty("Você ainda não salvou favoritos.")
        return
    }
    val titles = s.favorites.map {
        Title(
            id = it.tmdbId.toString(),
            title = it.title,
            tmdbId = it.tmdbId,
            type = it.mediaType,
            mediaType = it.mediaType,
        )
    }
    Column(Modifier.fillMaxSize()) {
        Text(
            "Favoritos",
            color = MfColors.Text,
            fontSize = 26.sp,
            fontWeight = FontWeight.Black,
            modifier = Modifier.padding(start = 48.dp, top = 28.dp, bottom = 16.dp),
        )
        androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
            columns = androidx.compose.foundation.lazy.grid.GridCells.Adaptive(minSize = 150.dp),
            contentPadding = PaddingValues(horizontal = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(titles.size, key = { "${titles[it].type}-${titles[it].tmdbId}" }) { i ->
                TvPosterCard(titles[i], { onOpen(titles[i]) }, width = 200)
            }
        }
    }
}

@Composable
fun TvDetailScreen(
    vm: TvViewModel,
    title: Title,
    onPlay: (Int?, Int?) -> Unit,
    onBack: () -> Unit,
) {
    val s by vm.state.collectAsState()
    val isSeries = title.isSeries
    var selectedSeason by remember { mutableStateOf(1) }

    LaunchedEffect(title.tmdbId) { if (isSeries) vm.loadSeasons(title.tmdbId) }

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(300.dp),
            ) {
                AsyncImage(
                    model = title.backdropUrl.ifBlank { title.posterUrl },
                    contentDescription = title.title,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                listOf(Color.Transparent, MfColors.Bg.copy(alpha = 0.85f), MfColors.Bg),
                            ),
                        ),
                )
            }
        }
        item {
            Column(Modifier.padding(horizontal = 48.dp)) {
                Text(title.title, color = MfColors.Text, fontSize = 32.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("★ ${title.ratingLabel}", color = MfColors.Warning, fontSize = 14.sp)
                    Spacer(Modifier.width(14.dp))
                    Text(title.year, color = MfColors.TextMuted, fontSize = 14.sp)
                    Spacer(Modifier.width(14.dp))
                    Text(title.quality, color = MfColors.TextMuted, fontSize = 14.sp)
                }
                Spacer(Modifier.height(18.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    TvActionButton("▶  Assistir", primary = true) {
                        if (isSeries) {
                            val parts = title.episodesAvailable?.firstOrNull()
                                ?.split("/")?.mapNotNull { it.toIntOrNull() }
                            onPlay(parts?.getOrNull(0) ?: 1, parts?.getOrNull(1) ?: 1)
                        } else onPlay(null, null)
                    }
                    TvActionButton(
                        if (vm.isFavorite(title.tmdbId)) "♥ Favorito" else "♡ Favoritar",
                        primary = false,
                    ) { vm.toggleFavorite(title) }
                }
                Spacer(Modifier.height(18.dp))
                if (title.description.isNotBlank()) {
                    Text(
                        title.description,
                        color = MfColors.TextMuted,
                        fontSize = 14.sp,
                        lineHeight = 21.sp,
                        modifier = Modifier.width(900.dp),
                    )
                }
                Spacer(Modifier.height(24.dp))
            }
        }

        if (isSeries && s.seasons.isNotEmpty()) {
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 48.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(s.seasons) { season ->
                        var focused by remember { mutableStateOf(false) }
                        val sel = season.seasonNumber == selectedSeason
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(20.dp))
                                .background(
                                    when {
                                        focused -> MfColors.Red
                                        sel -> MfColors.RedDark
                                        else -> MfColors.BgCard
                                    },
                                )
                                .onFocusChanged { focused = it.isFocused }
                                .clickable { selectedSeason = season.seasonNumber }
                                .padding(horizontal = 18.dp, vertical = 9.dp),
                        ) {
                            Text(
                                "Temporada ${season.seasonNumber}",
                                color = Color.White,
                                fontSize = 13.sp,
                                fontWeight = if (sel || focused) FontWeight.Bold else FontWeight.Normal,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
            }

            val season = s.seasons.firstOrNull { it.seasonNumber == selectedSeason }
            items(season?.episodes ?: emptyList()) { ep ->
                var focused by remember { mutableStateOf(false) }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 48.dp, vertical = 4.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (focused) MfColors.BgHover else Color.Transparent)
                        .onFocusChanged { focused = it.isFocused }
                        .clickable { onPlay(selectedSeason, ep.episodeNumber) }
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .width(120.dp)
                            .height(68.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(MfColors.BgCard),
                    ) {
                        AsyncImage(
                            model = ep.thumbnailUrl,
                            contentDescription = ep.title,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                    Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "${ep.episodeNumber}. ${ep.title}",
                            color = if (focused) MfColors.Text else MfColors.TextSoft,
                            fontSize = 15.sp,
                            fontWeight = if (focused) FontWeight.Bold else FontWeight.Medium,
                        )
                        if (ep.durationSeconds != null) {
                            Text("${ep.durationSeconds / 60} min", color = MfColors.TextDim, fontSize = 12.sp)
                        }
                    }
                    if (focused) Text("▶", color = MfColors.Red, fontSize = 18.sp)
                }
            }
        }

        item { Spacer(Modifier.height(40.dp)) }
    }
}

@Composable
private fun TvActionButton(text: String, primary: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(
                when {
                    focused && primary -> MfColors.RedBright
                    focused -> MfColors.BgHover
                    primary -> MfColors.Red
                    else -> MfColors.BgCard
                },
            )
            .then(
                if (focused) Modifier.border(2.dp, Color.White, RoundedCornerShape(8.dp)) else Modifier,
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(onClick = onClick)
            .padding(horizontal = 28.dp, vertical = 12.dp),
    ) {
        Text(text, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

@Composable
fun TvLoginScreen(vm: TvViewModel, onDone: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val emailFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) { runCatching { emailFocus.requestFocus() } }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(80.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("MOVIEFLIX", color = MfColors.Red, fontSize = 40.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(10.dp))
        Text("Entre com sua conta do MovieFlix", color = MfColors.TextMuted, fontSize = 15.sp)
        Spacer(Modifier.height(36.dp))

        if (err != null) {
            Text(err!!, color = MfColors.Danger, fontSize = 14.sp, modifier = Modifier.padding(bottom = 14.dp))
        }

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("E-mail") },
            singleLine = true,
            modifier = Modifier
                .width(520.dp)
                .focusRequester(emailFocus)
                .padding(bottom = 14.dp),
        )
        OutlinedTextField(
            value = pass,
            onValueChange = { pass = it },
            label = { Text("Senha") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier
                .width(520.dp)
                .padding(bottom = 22.dp),
        )

        TvActionButton(if (busy) "Entrando…" else "Entrar", primary = true) {
            if (busy) return@TvActionButton
            busy = true
            err = null
            vm.login(email, pass) { e ->
                busy = false
                if (e == null) onDone() else err = e
            }
        }
    }
}

@Composable
fun TvAccountScreen(vm: TvViewModel, onLogin: () -> Unit) {
    val s by vm.state.collectAsState()

    Column(Modifier.fillMaxSize().padding(48.dp)) {
        Text("Minha conta", color = MfColors.Text, fontSize = 28.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(24.dp))

        if (!s.loggedIn) {
            Text("Você não está logado.", color = MfColors.TextMuted, fontSize = 16.sp)
            Spacer(Modifier.height(20.dp))
            TvActionButton("Entrar", primary = true) { onLogin() }
            return@Column
        }

        Text(s.email ?: "", color = MfColors.Text, fontSize = 18.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(8.dp))
        val sub = s.subscription
        val label = when {
            sub == null -> "Verificando acesso…"
            sub.allowed && sub.reason == "plan" -> "Plano ativo"
            sub.allowed -> "Mês grátis · ${sub.daysLeft ?: 0} dias restantes"
            else -> "Acesso encerrado"
        }
        Text(label, color = if (sub?.allowed == true) MfColors.Success else MfColors.Warning, fontSize = 15.sp)
        Spacer(Modifier.height(28.dp))
        TvActionButton("Sair da conta", primary = false) { vm.logout() }
    }
}
