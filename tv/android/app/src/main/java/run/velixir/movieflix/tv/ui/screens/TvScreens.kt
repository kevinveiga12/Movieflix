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
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import run.velixir.movieflix.tv.TvViewModel
import run.velixir.movieflix.tv.data.Title
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfHeroTitle
import run.velixir.movieflix.tv.ui.theme.MfSans

/* ==========================================================================
   Telas da TV. Cada uma corresponde a uma rota do site:
     TvHomeScreen      → /
     TvCatalogScreen   → /filmes e /series
     TvGenresScreen    → categorias
     TvSearchScreen    → /pesquisa
     TvFavoritesScreen → /favoritos
     TvHistoryScreen   → /historico
     TvPlansScreen     → /planos
     TvAccountScreen   → /perfil
     TvSettingsScreen  → /configuracoes
     TvDetailScreen    → /titulo/:type/:id
   ========================================================================== */

@Composable
fun TvHomeScreen(vm: TvViewModel, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()

    when {
        s.loading && s.movies.isEmpty() -> TvLoading()
        s.error != null && s.movies.isEmpty() -> TvError(s.error!!) { vm.loadHome() }
        else -> LazyColumn(Modifier.fillMaxSize()) {
            item {
                TvHero(
                    s.movies.firstOrNull(),
                    onPlay = { s.movies.firstOrNull()?.let(onOpen) },
                    onDetails = { s.movies.firstOrNull()?.let(onOpen) },
                )
            }

            // Chips de gênero — o .chip-row do site.
            if (s.genres.isNotEmpty()) {
                item {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 48.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.padding(bottom = 24.dp),
                    ) {
                        items(s.genres.take(14)) { g ->
                            TvChip(g) { vm.loadCatalog("movie", g) }
                        }
                    }
                }
            }

            // Continuar assistindo — cards largos 16:9.
            if (s.history.isNotEmpty()) {
                item {
                    Column(Modifier.padding(bottom = 26.dp)) {
                        MfSectionHeading(
                            "Continuar assistindo",
                            modifier = Modifier.padding(start = 48.dp, bottom = 14.dp),
                        )
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 48.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            items(s.history) { h ->
                                TvWideCard(
                                    title = h.title,
                                    imageUrl = h.posterUrl,
                                    progress = h.progress,
                                    onClick = {
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
                                    },
                                )
                            }
                        }
                    }
                }
            }

            item { TvRow("Filmes", s.movies, onItemClick = { onOpen(it) }) }
            item { TvRow("Séries", s.series, onItemClick = { onOpen(it) }) }
            item { Spacer(Modifier.height(30.dp)) }
        }
    }
}

/** Chip de gênero com foco visível — o .chip do site. */
@Composable
fun TvChip(label: String, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (focused) MfColors.Red else MfColors.BgCard)
            .border(
                1.dp,
                if (focused) Color.Transparent else MfColors.Border,
                RoundedCornerShape(20.dp),
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 9.dp),
    ) {
        Text(
            label,
            color = if (focused) Color.White else MfColors.TextSoft,
            fontFamily = MfSans,
            fontSize = 13.sp,
            fontWeight = if (focused) FontWeight.Bold else FontWeight.Normal,
        )
    }
}

/** Card largo 16:9 de "continuar assistindo" — o .card--wide do site. */
@Composable
fun TvWideCard(title: String, imageUrl: String, progress: Double, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .width(280.dp)
            .onFocusChanged { focused = it.isFocused }
            .clickable(onClick = onClick)
            .padding(4.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(158.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(MfColors.BgCard)
                .then(
                    if (focused) Modifier.border(3.dp, MfColors.Red, RoundedCornerShape(12.dp))
                    else Modifier.border(1.dp, MfColors.Border, RoundedCornerShape(12.dp)),
                ),
        ) {
            AsyncImage(
                model = imageUrl,
                contentDescription = title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (focused) {
                Box(
                    Modifier
                        .align(Alignment.Center)
                        .width(44.dp)
                        .height(44.dp)
                        .clip(RoundedCornerShape(22.dp))
                        .background(MfColors.Red.copy(alpha = 0.95f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("▶", color = Color.White, fontSize = 15.sp)
                }
            }
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .height(3.dp)
                    .background(Color.White.copy(alpha = 0.15f)),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(progress.toFloat().coerceIn(0f, 1f))
                        .height(3.dp)
                        .background(MfColors.Red),
                )
            }
        }
        Spacer(Modifier.height(7.dp))
        Text(
            title,
            color = if (focused) MfColors.Text else MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 13.sp,
            fontWeight = if (focused) FontWeight.Bold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
fun TvCatalogScreen(vm: TvViewModel, kind: String, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()
    val list = if (kind == "tv") s.series else s.movies
    var genre by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(kind) { vm.loadCatalog(kind) }

    Column(Modifier.fillMaxSize()) {
        TvPageTitle(if (kind == "tv") "Séries" else "Filmes")

        if (s.genres.isNotEmpty()) {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 48.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.padding(bottom = 18.dp),
            ) {
                item {
                    TvChip("Todos") {
                        genre = null
                        vm.loadCatalog(kind, null)
                    }
                }
                items(s.genres.take(14)) { g ->
                    TvChip(g) {
                        genre = g
                        vm.loadCatalog(kind, g)
                    }
                }
            }
        }

        when {
            s.loading && list.isEmpty() -> TvLoading()
            list.isEmpty() -> TvEmpty("Nada por aqui ainda.")
            else -> androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
                columns = androidx.compose.foundation.lazy.grid.GridCells.Adaptive(minSize = 150.dp),
                contentPadding = PaddingValues(horizontal = 48.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                items(list.size, key = { "${list[it].type}-${list[it].tmdbId}" }) { i ->
                    TvPosterCard(list[i], { onOpen(list[i]) }, width = 200)
                }
            }
        }
    }
}

/** Categorias/gêneros — a rota /categorias do site. */
@Composable
fun TvGenresScreen(vm: TvViewModel, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()
    var selected by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        TvPageTitle("Categorias")

        if (s.genres.isEmpty()) {
            TvEmpty("Carregando categorias…", "🏷️")
            return@Column
        }

        LazyRow(
            contentPadding = PaddingValues(horizontal = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.padding(bottom = 20.dp),
        ) {
            items(s.genres) { g ->
                TvChip(g) {
                    selected = g
                    vm.loadCatalog("movie", g)
                }
            }
        }

        if (selected != null) {
            MfSectionHeading(
                selected!!,
                modifier = Modifier.padding(start = 48.dp, bottom = 14.dp),
            )
            androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
                columns = androidx.compose.foundation.lazy.grid.GridCells.Adaptive(minSize = 150.dp),
                contentPadding = PaddingValues(horizontal = 48.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                items(s.movies.size, key = { "${s.movies[it].type}-${s.movies[it].tmdbId}" }) { i ->
                    TvPosterCard(s.movies[i], { onOpen(s.movies[i]) }, width = 200)
                }
            }
        } else {
            TvEmpty("Escolha uma categoria para ver os títulos.", "🏷️")
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
        TvPageTitle("Buscar")
        OutlinedTextField(
            value = term,
            onValueChange = {
                term = it
                vm.search(it)
            },
            placeholder = { Text("Buscar filmes e séries", color = MfColors.TextDim) },
            singleLine = true,
            shape = RoundedCornerShape(10.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = MfColors.Red,
                unfocusedBorderColor = MfColors.Border,
                focusedContainerColor = MfColors.BgCard,
                unfocusedContainerColor = MfColors.BgCard,
                focusedTextColor = MfColors.Text,
                unfocusedTextColor = MfColors.Text,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 48.dp)
                .padding(bottom = 20.dp)
                .focusRequester(focus),
        )
        when {
            term.isBlank() -> TvEmpty("Digite para buscar no catálogo.", "🔍")
            s.loading -> TvLoading()
            s.searchResults.isEmpty() -> TvEmpty("Nenhum resultado para \"$term\".", "🔍")
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

    Column(Modifier.fillMaxSize()) {
        TvPageTitle("Favoritos")
        if (!s.loggedIn) {
            TvEmpty("Entre na sua conta para ver seus favoritos.", "♡")
            return@Column
        }
        if (s.favorites.isEmpty()) {
            TvEmpty("Você ainda não salvou favoritos.", "♡")
            return@Column
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

/** Histórico — a rota /historico do site. */
@Composable
fun TvHistoryScreen(vm: TvViewModel, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()

    Column(Modifier.fillMaxSize()) {
        TvPageTitle("Histórico")
        if (!s.loggedIn) {
            TvEmpty("Entre na sua conta para ver seu histórico.", "🕒")
            return@Column
        }
        if (s.history.isEmpty()) {
            TvEmpty("Nada no histórico ainda.", "🕒")
            return@Column
        }
        val titles = s.history.map {
            Title(
                id = it.tmdbId.toString(),
                title = it.title,
                posterUrl = it.posterUrl,
                tmdbId = it.tmdbId,
                type = it.mediaType,
                mediaType = it.mediaType,
            )
        }
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

/** Planos — a rota /planos do site, com os descontos de 3 meses e 1 ano. */
@Composable
fun TvPlansScreen(vm: TvViewModel) {
    val s by vm.state.collectAsState()
    LaunchedEffect(Unit) { vm.loadPlans() }

    Column(Modifier.fillMaxSize()) {
        TvPageTitle("Planos")
        Text(
            "Escolha o plano e fale com a gente pelo WhatsApp.",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 14.sp,
            modifier = Modifier.padding(start = 48.dp, bottom = 20.dp),
        )

        if (s.plans.isEmpty()) {
            TvEmpty("Carregando planos…", "💳")
            return@Column
        }

        LazyRow(
            contentPadding = PaddingValues(horizontal = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(s.plans) { plan ->
                var focused by remember { mutableStateOf(false) }
                Column(
                    modifier = Modifier
                        .width(340.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(MfColors.BgCard)
                        .then(
                            if (focused) Modifier.border(3.dp, MfColors.Red, RoundedCornerShape(16.dp))
                            else Modifier.border(1.dp, MfColors.Border, RoundedCornerShape(16.dp)),
                        )
                        .onFocusChanged { focused = it.isFocused }
                        .padding(22.dp),
                ) {
                    Text(
                        plan.name,
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        plan.priceLabel,
                        color = MfColors.Red,
                        fontFamily = MfSans,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Black,
                    )
                    if (!plan.description.isNullOrBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            plan.description!!,
                            color = MfColors.TextMuted,
                            fontFamily = MfSans,
                            fontSize = 12.sp,
                        )
                    }
                    Spacer(Modifier.height(14.dp))
                    plan.periods.forEach { p ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                p.label,
                                color = MfColors.TextSoft,
                                fontFamily = MfSans,
                                fontSize = 12.sp,
                                modifier = Modifier.width(78.dp),
                            )
                            if (!p.fullLabel.isNullOrBlank()) {
                                Text(
                                    p.fullLabel!!,
                                    color = MfColors.TextDim,
                                    fontFamily = MfSans,
                                    fontSize = 11.sp,
                                    textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough,
                                )
                                Spacer(Modifier.width(7.dp))
                            }
                            Text(
                                p.priceLabel,
                                color = MfColors.Text,
                                fontFamily = MfSans,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                            )
                            if (!p.savedLabel.isNullOrBlank()) {
                                Spacer(Modifier.width(7.dp))
                                Text(
                                    "−${p.savedLabel}",
                                    color = MfColors.Success,
                                    fontFamily = MfSans,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
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
                    .height(340.dp),
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
                                0f to Color.Black.copy(alpha = 0.30f),
                                0.45f to MfColors.Bg.copy(alpha = 0.60f),
                                1f to MfColors.Bg,
                            ),
                        ),
                )
            }
        }
        item {
            Column(Modifier.padding(horizontal = 48.dp)) {
                Text(
                    title.title.uppercase(),
                    style = MfHeroTitle.copy(fontSize = 40.sp, lineHeight = 38.sp),
                    color = MfColors.Text,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (title.voteAverage != null && title.voteAverage > 0) {
                        Text(
                            "★ ${title.ratingLabel}",
                            color = MfColors.Warning,
                            fontFamily = MfSans,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.width(14.dp))
                    }
                    Text(title.year, color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 14.sp)
                    if (title.quality.isNotBlank()) {
                        Spacer(Modifier.width(14.dp))
                        Text(title.quality, color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 14.sp)
                    }
                    if (isSeries && title.seasons != null) {
                        Spacer(Modifier.width(14.dp))
                        Text(
                            "${title.seasons} temporadas",
                            color = MfColors.TextMuted,
                            fontFamily = MfSans,
                            fontSize = 14.sp,
                        )
                    }
                }
                Spacer(Modifier.height(20.dp))
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
                Spacer(Modifier.height(20.dp))
                if (title.description.isNotBlank()) {
                    Text(
                        title.description,
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                        lineHeight = 22.sp,
                        modifier = Modifier.width(980.dp),
                    )
                }
                Spacer(Modifier.height(26.dp))
            }
        }

        if (isSeries && s.seasons.isNotEmpty()) {
            item {
                MfSectionHeading(
                    "Temporadas",
                    modifier = Modifier.padding(start = 48.dp, bottom = 12.dp),
                )
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
                                fontFamily = MfSans,
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
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (focused) MfColors.BgHover else Color.Transparent)
                        .then(
                            if (focused) Modifier.border(2.dp, MfColors.Red, RoundedCornerShape(10.dp))
                            else Modifier,
                        )
                        .onFocusChanged { focused = it.isFocused }
                        .clickable { onPlay(selectedSeason, ep.episodeNumber) }
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .width(132.dp)
                            .height(74.dp)
                            .clip(RoundedCornerShape(8.dp))
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
                            fontFamily = MfSans,
                            fontSize = 15.sp,
                            fontWeight = if (focused) FontWeight.Bold else FontWeight.Medium,
                        )
                        if (ep.durationSeconds != null) {
                            Text(
                                "${ep.durationSeconds / 60} min",
                                color = MfColors.TextDim,
                                fontFamily = MfSans,
                                fontSize = 12.sp,
                            )
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
fun TvActionButton(text: String, primary: Boolean, onClick: () -> Unit) {
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
                if (focused) Modifier.border(2.dp, Color.White, RoundedCornerShape(8.dp))
                else if (!primary) Modifier.border(1.dp, MfColors.Border, RoundedCornerShape(8.dp))
                else Modifier,
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(onClick = onClick)
            .padding(horizontal = 28.dp, vertical = 12.dp),
    ) {
        Text(text, color = Color.White, fontFamily = MfSans, fontWeight = FontWeight.Bold, fontSize = 15.sp)
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
        MfLogo(fontSize = 40, iconSize = 54)
        Spacer(Modifier.height(12.dp))
        Text(
            "Entre com sua conta do MovieFlix",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 15.sp,
        )
        Spacer(Modifier.height(36.dp))

        if (err != null) {
            Text(
                err!!,
                color = MfColors.Danger,
                fontFamily = MfSans,
                fontSize = 14.sp,
                modifier = Modifier.padding(bottom = 14.dp),
            )
        }

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("E-mail") },
            singleLine = true,
            shape = RoundedCornerShape(10.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = MfColors.Red,
                unfocusedBorderColor = MfColors.Border,
                focusedContainerColor = MfColors.BgCard,
                unfocusedContainerColor = MfColors.BgCard,
                focusedTextColor = MfColors.Text,
                unfocusedTextColor = MfColors.Text,
            ),
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
            shape = RoundedCornerShape(10.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = MfColors.Red,
                unfocusedBorderColor = MfColors.Border,
                focusedContainerColor = MfColors.BgCard,
                unfocusedContainerColor = MfColors.BgCard,
                focusedTextColor = MfColors.Text,
                unfocusedTextColor = MfColors.Text,
            ),
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
        TvPageTitle("Minha conta")
        Spacer(Modifier.height(8.dp))

        if (!s.loggedIn) {
            Text(
                "Você não está logado.",
                color = MfColors.TextMuted,
                fontFamily = MfSans,
                fontSize = 16.sp,
            )
            Spacer(Modifier.height(20.dp))
            TvActionButton("Entrar", primary = true) { onLogin() }
            return@Column
        }

        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(16.dp))
                .background(MfColors.BgCard)
                .border(1.dp, MfColors.Border, RoundedCornerShape(16.dp))
                .padding(24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .width(64.dp)
                    .height(64.dp)
                    .clip(RoundedCornerShape(32.dp))
                    .background(MfColors.Red),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    (s.email ?: "?").trim().firstOrNull()?.uppercase() ?: "?",
                    color = Color.White,
                    fontFamily = MfSans,
                    fontSize = 26.sp,
                    fontWeight = FontWeight.Black,
                )
            }
            Spacer(Modifier.width(20.dp))
            Column {
                Text(
                    s.email ?: "",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(6.dp))
                val sub = s.subscription
                val label = when {
                    sub == null -> "Verificando acesso…"
                    sub.allowed && sub.reason == "plan" -> "Plano ativo"
                    sub.allowed -> "Mês grátis · ${sub.daysLeft ?: 0} dias restantes"
                    else -> "Acesso encerrado"
                }
                Text(
                    label,
                    color = if (sub?.allowed == true) MfColors.Success else MfColors.Warning,
                    fontFamily = MfSans,
                    fontSize = 14.sp,
                )
            }
        }

        Spacer(Modifier.height(28.dp))
        TvActionButton("Sair da conta", primary = false) { vm.logout() }
    }
}

/** Configurações — a rota /configuracoes do site. */
@Composable
fun TvSettingsScreen(vm: TvViewModel) {
    val s by vm.state.collectAsState()

    Column(Modifier.fillMaxSize().padding(48.dp)) {
        TvPageTitle("Configurações")
        Spacer(Modifier.height(8.dp))

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            TvSettingRow("Reprodução", "O player usa o controle remoto: setas ±10s, OK pausa")
            TvSettingRow("Qualidade", "Automática, conforme a conexão")
            TvSettingRow("Idioma", "Português (Brasil)")
            TvSettingRow("Conta", s.email ?: "não logado")
            TvSettingRow("Versão", "MovieFlix TV 1.0.0")
        }

        Spacer(Modifier.height(24.dp))
        Text(
            "Filmes e séries dublados em pt-BR, sem anúncios.",
            color = MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 13.sp,
        )
    }
}

@Composable
private fun TvSettingRow(label: String, value: String) {
    var focused by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .width(760.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(MfColors.BgCard)
            .then(
                if (focused) Modifier.border(2.dp, MfColors.Red, RoundedCornerShape(10.dp))
                else Modifier.border(1.dp, MfColors.Border, RoundedCornerShape(10.dp)),
            )
            .onFocusChanged { focused = it.isFocused }
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.weight(1f))
        Text(value, color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 13.sp)
    }
}
