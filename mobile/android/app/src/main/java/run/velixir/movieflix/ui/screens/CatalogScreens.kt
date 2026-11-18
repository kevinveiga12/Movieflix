package run.velixir.movieflix.ui.screens

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import run.velixir.movieflix.AppViewModel
import run.velixir.movieflix.data.Title
import run.velixir.movieflix.ui.Chip
import run.velixir.movieflix.ui.EmptyState
import run.velixir.movieflix.ui.ErrorBox
import run.velixir.movieflix.ui.HeroBanner
import run.velixir.movieflix.ui.LoadingBox
import run.velixir.movieflix.ui.MfLogo
import run.velixir.movieflix.ui.PosterCard
import run.velixir.movieflix.ui.PosterGrid
import run.velixir.movieflix.ui.SectionTitle
import run.velixir.movieflix.ui.TitleRow
import run.velixir.movieflix.ui.WideCard
import run.velixir.movieflix.ui.theme.MfColors
import run.velixir.movieflix.ui.theme.MfSans

/* ==========================================================================
   Telas de catálogo do app mobile.

   Cada tela corresponde a uma rota do site:
     HomeScreen      → /
     CatalogScreen   → /filmes e /series
     GenresScreen    → categorias/gêneros
     SearchScreen    → /pesquisa
     FavoritesScreen → /favoritos
     HistoryScreen   → /historico
   ========================================================================== */

/** Cabeçalho fixo com a logo real do site e o atalho de busca. */
@Composable
fun MfTopBar(onSearch: () -> Unit, onLogo: () -> Unit = {}) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.clickable(onClick = onLogo)) {
            MfLogo(fontSize = 23, iconSize = 30)
        }
        Spacer(Modifier.weight(1f))
        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(CircleShape)
                .background(MfColors.BgCard)
                .border(1.dp, MfColors.Border, CircleShape)
                .clickable(onClick = onSearch),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Default.Search,
                contentDescription = "Pesquisar",
                tint = MfColors.TextSoft,
                modifier = Modifier.size(19.dp),
            )
        }
    }
}

@Composable
fun HomeScreen(
    vm: AppViewModel,
    onOpen: (Title) -> Unit,
    onSearch: () -> Unit,
    onGenres: () -> Unit = {},
) {
    val s by vm.state.collectAsState()

    if (s.loading && s.movies.isEmpty()) {
        LoadingBox()
        return
    }
    if (s.error != null && s.movies.isEmpty()) {
        ErrorBox(s.error!!) { vm.loadHome() }
        return
    }

    val hero = s.movies.firstOrNull()

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item { MfTopBar(onSearch) }

        item {
            HeroBanner(
                title = hero,
                onPlay = { hero?.let(onOpen) },
                onDetails = { hero?.let(onOpen) },
            )
        }

        // Chips de gênero — o .chip-row do site.
        if (s.genres.isNotEmpty()) {
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 4.dp, bottom = 20.dp),
                ) {
                    items(s.genres.take(16)) { g ->
                        Chip(g, false) { onGenres() }
                    }
                }
            }
        }

        // Continuar assistindo — cards largos 16:9, como o .card--wide.
        if (s.history.isNotEmpty()) {
            item {
                Column(Modifier.padding(bottom = 20.dp)) {
                    SectionTitle("Continuar assistindo")
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(s.history) { h ->
                            WideCard(
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

        item { TitleRow("Filmes", s.movies, onItemClick = { onOpen(it) }) }
        item { TitleRow("Séries", s.series, onItemClick = { onOpen(it) }) }

        item { Spacer(Modifier.height(20.dp)) }
    }
}

@Composable
fun CatalogScreen(
    vm: AppViewModel,
    kind: String,
    onOpen: (Title) -> Unit,
    onSearch: () -> Unit = {},
) {
    val s by vm.state.collectAsState()
    val list = if (kind == "tv") s.series else s.movies
    var genre by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(kind) { vm.loadCatalog(kind) }

    Column(Modifier.fillMaxSize()) {
        MfTopBar(onSearch)
        when {
            s.loading && list.isEmpty() -> LoadingBox()
            s.error != null && list.isEmpty() -> ErrorBox(s.error!!) { vm.loadCatalog(kind, genre) }
            list.isEmpty() -> EmptyState("Nada por aqui ainda.")
            else -> PosterGrid(
                titles = list,
                onItemClick = onOpen,
                header = {
                    Column {
                        Text(
                            if (kind == "tv") "Séries" else "Filmes",
                            color = MfColors.Text,
                            fontFamily = MfSans,
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Black,
                            modifier = Modifier.padding(bottom = 12.dp),
                        )
                        if (s.genres.isNotEmpty()) {
                            LazyRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.padding(bottom = 14.dp),
                            ) {
                                item {
                                    Chip("Todos", genre == null) {
                                        genre = null
                                        vm.loadCatalog(kind, null)
                                    }
                                }
                                items(s.genres.take(14)) { g ->
                                    Chip(g, genre == g) {
                                        genre = g
                                        vm.loadCatalog(kind, g)
                                    }
                                }
                            }
                        }
                    }
                },
            )
        }
    }
}

/** Tela de categorias/gêneros — a rota /categorias do site. */
@Composable
fun GenresScreen(
    vm: AppViewModel,
    onOpen: (Title) -> Unit,
    onSearch: () -> Unit = {},
) {
    val s by vm.state.collectAsState()
    var selected by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        MfTopBar(onSearch)
        Text(
            "Categorias",
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 24.sp,
            fontWeight = FontWeight.Black,
            modifier = Modifier.padding(start = 16.dp, bottom = 14.dp),
        )

        if (s.genres.isEmpty()) {
            EmptyState("Carregando categorias…", "🏷️")
            return@Column
        }

        LazyColumn(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(s.genres) { g ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (selected == g) MfColors.Red else MfColors.BgCard)
                        .border(
                            1.dp,
                            if (selected == g) Color.Transparent else MfColors.Border,
                            RoundedCornerShape(10.dp),
                        )
                        .clickable {
                            selected = g
                            vm.loadCatalog("movie", g)
                        }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        g,
                        color = if (selected == g) Color.White else MfColors.TextSoft,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                        fontWeight = if (selected == g) FontWeight.Bold else FontWeight.Normal,
                    )
                    Spacer(Modifier.weight(1f))
                    Text("›", color = MfColors.TextDim, fontSize = 18.sp)
                }
            }
        }
    }
}

@Composable
fun SearchScreen(vm: AppViewModel, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()
    var term by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize()) {
        MfTopBar(onSearch = {})
        OutlinedTextField(
            value = term,
            onValueChange = {
                term = it
                vm.search(it)
            },
            placeholder = { Text("Buscar filmes e séries", color = MfColors.TextDim, fontSize = 14.sp) },
            singleLine = true,
            leadingIcon = {
                Icon(Icons.Default.Search, contentDescription = null, tint = MfColors.TextDim)
            },
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
                .padding(horizontal = 16.dp, vertical = 4.dp),
        )
        Spacer(Modifier.height(12.dp))
        when {
            term.isBlank() -> EmptyState("Digite para buscar no catálogo.", "🔍")
            s.loading -> LoadingBox()
            s.searchResults.isEmpty() -> EmptyState("Nenhum resultado para \"$term\".", "🔍")
            else -> PosterGrid(titles = s.searchResults, onItemClick = onOpen)
        }
    }
}

@Composable
fun FavoritesScreen(vm: AppViewModel, onOpen: (Title) -> Unit, onSearch: () -> Unit = {}) {
    val s by vm.state.collectAsState()

    Column(Modifier.fillMaxSize()) {
        MfTopBar(onSearch)
        if (!s.loggedIn) {
            EmptyState("Entre na sua conta para ver seus favoritos.", "♡")
            return@Column
        }
        if (s.favorites.isEmpty()) {
            EmptyState("Você ainda não salvou favoritos.", "♡")
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
        PosterGrid(
            titles = titles,
            onItemClick = onOpen,
            header = {
                Text(
                    "Favoritos",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.padding(bottom = 12.dp),
                )
            },
        )
    }
}

@Composable
fun HistoryScreen(vm: AppViewModel, onOpen: (Title) -> Unit, onSearch: () -> Unit = {}) {
    val s by vm.state.collectAsState()

    Column(Modifier.fillMaxSize()) {
        MfTopBar(onSearch)
        if (!s.loggedIn) {
            EmptyState("Entre na sua conta para ver seu histórico.", "🕒")
            return@Column
        }
        if (s.history.isEmpty()) {
            EmptyState("Nada no histórico ainda.", "🕒")
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
        PosterGrid(
            titles = titles,
            onItemClick = onOpen,
            header = {
                Text(
                    "Histórico",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier.padding(bottom = 12.dp),
                )
            },
        )
    }
}
