package run.velixir.movieflix.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import run.velixir.movieflix.ui.PosterGrid
import run.velixir.movieflix.ui.TitleRow
import run.velixir.movieflix.ui.theme.MfBrand
import run.velixir.movieflix.ui.theme.MfColors
import run.velixir.movieflix.ui.theme.MfSans

@Composable
fun HomeScreen(vm: AppViewModel, onOpen: (Title) -> Unit, onSearch: () -> Unit) {
    val s by vm.state.collectAsState()

    if (s.loading && s.movies.isEmpty()) {
        LoadingBox()
        return
    }
    if (s.error != null && s.movies.isEmpty()) {
        ErrorBox(s.error!!) { vm.loadHome() }
        return
    }

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "MOVIEFLIX",
                    style = MfBrand.copy(fontSize = 24.sp),
                    color = MfColors.Red,
                )
                Spacer(Modifier.weight(1f))
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(RoundedCornerShape(50))
                        .background(MfColors.BgCard)
                        .clickable(onClick = onSearch),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Search, contentDescription = "Pesquisar", tint = MfColors.TextSoft)
                }
            }
        }

        item {
            HeroBanner(s.movies.firstOrNull()) { s.movies.firstOrNull()?.let(onOpen) }
        }

        item {
            if (s.genres.isNotEmpty()) {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(bottom = 18.dp),
                ) {
                    items(s.genres.take(14)) { g ->
                        Chip(g, false) { }
                    }
                }
            }
        }

        item { TitleRow("Filmes", s.movies) { onOpen(it) } }
        item { TitleRow("Séries", s.series) { onOpen(it) } }

        if (s.history.isNotEmpty()) {
            item {
                Column(Modifier.padding(bottom = 18.dp)) {
                    Text(
                        "Continuar assistindo",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(start = 16.dp, bottom = 10.dp),
                    )
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(s.history) { h ->
                            Column(
                                modifier = Modifier
                                    .width(150.dp)
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
                                    },
                            ) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(84.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(MfColors.BgCard),
                                ) {
                                    coil.compose.AsyncImage(
                                        model = h.posterUrl,
                                        contentDescription = h.title,
                                        contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                                        modifier = Modifier.fillMaxSize(),
                                    )
                                    Box(
                                        modifier = Modifier
                                            .align(Alignment.BottomStart)
                                            .fillMaxWidth()
                                            .height(3.dp)
                                            .background(MfColors.BgHover),
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth(h.progress.toFloat().coerceIn(0f, 1f))
                                                .height(3.dp)
                                                .background(MfColors.Red),
                                        )
                                    }
                                }
                                Spacer(Modifier.height(5.dp))
                                Text(
                                    h.title,
                                    color = MfColors.TextSoft,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }
        }

        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
fun CatalogScreen(
    vm: AppViewModel,
    kind: String,
    onOpen: (Title) -> Unit,
) {
    val s by vm.state.collectAsState()
    val items = if (kind == "tv") s.series else s.movies

    Column(Modifier.fillMaxSize()) {
        Text(
            if (kind == "tv") "Séries" else "Filmes",
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 22.sp,
            fontWeight = FontWeight.Black,
            modifier = Modifier.padding(16.dp),
        )
        when {
            s.loading && items.isEmpty() -> LoadingBox()
            s.error != null && items.isEmpty() -> ErrorBox(s.error!!) { vm.loadCatalog(kind) }
            items.isEmpty() -> EmptyState("Nada por aqui ainda.")
            else -> PosterGrid(items, onOpen)
        }
    }
}

@Composable
fun SearchScreen(vm: AppViewModel, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()
    var term by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }

    Column(Modifier.fillMaxSize()) {
        androidx.compose.material3.OutlinedTextField(
            value = term,
            onValueChange = {
                term = it
                vm.search(it)
            },
            placeholder = { Text("Buscar filmes e séries", color = MfColors.TextDim) },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
        )
        when {
            term.isBlank() -> EmptyState("Digite para buscar no catálogo.")
            s.loading -> LoadingBox()
            s.searchResults.isEmpty() -> EmptyState("Nenhum resultado para \"$term\".")
            else -> PosterGrid(s.searchResults, onOpen)
        }
    }
}

@Composable
fun FavoritesScreen(vm: AppViewModel, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()

    if (!s.loggedIn) {
        EmptyState("Entre na sua conta para ver seus favoritos.")
        return
    }
    if (s.favorites.isEmpty()) {
        EmptyState("Você ainda não salvou favoritos.")
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
            fontFamily = MfSans,
            fontSize = 22.sp,
            fontWeight = FontWeight.Black,
            modifier = Modifier.padding(16.dp),
        )
        PosterGrid(titles, onOpen)
    }
}

@Composable
fun HistoryScreen(vm: AppViewModel, onOpen: (Title) -> Unit) {
    val s by vm.state.collectAsState()

    if (!s.loggedIn) {
        EmptyState("Entre na sua conta para ver seu histórico.")
        return
    }
    if (s.history.isEmpty()) {
        EmptyState("Nada no histórico ainda.")
        return
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
    Column(Modifier.fillMaxSize()) {
        Text(
            "Histórico",
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 22.sp,
            fontWeight = FontWeight.Black,
            modifier = Modifier.padding(16.dp),
        )
        PosterGrid(titles, onOpen)
    }
}
