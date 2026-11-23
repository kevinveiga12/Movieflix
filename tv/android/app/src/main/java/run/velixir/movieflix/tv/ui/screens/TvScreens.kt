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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
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
fun TvHomeScreen(vm: TvViewModel, onOpen: (Title) -> Unit, onLoginRequired: () -> Unit = {}) {
    val s by vm.state.collectAsState()

    when {
        s.loading && s.movies.isEmpty() -> TvLoading()
        s.error != null && s.movies.isEmpty() -> TvError(s.error!!) { vm.loadHome() }
        else -> LazyColumn(Modifier.fillMaxSize()) {
            item {
                TvHero(
                    s.movies.firstOrNull(),
                    /*
                      "Assistir" sem sessão vai DIRETO ao login.

                      O proprietário pediu: clicar em assistir sem estar logado
                      redireciona imediatamente para a página de login, sem
                      telas intermediárias. Antes este botão abria a tela do
                      título, e só depois de um segundo toque o login aparecia.
                    */
                    onPlay = {
                        s.movies.firstOrNull()?.let { t ->
                            if (s.loggedIn) onOpen(t) else onLoginRequired()
                        }
                    },
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
    val gridState = rememberLazyGridState()

    LaunchedEffect(kind) { vm.loadCatalog(kind) }

    /*
      ── Carregamento automático (item 3) ──────────────────────────────────────

      Antes a tela pedia 60 itens e parava: a navegação terminava no fim da
      grade mesmo existindo centenas de títulos cadastrados.

      Agora, quando o foco chega perto do último item carregado, o próximo bloco
      é buscado sozinho. O gatilho é a POSIÇÃO DO FOCO, não o scroll: na TV quem
      rola é o D-pad, e `layoutInfo.visibleItemsInfo` só reflete o que está na
      tela. Usar o índice do item focado garante que o carregamento acontece
      exatamente quando a pessoa está chegando ao fim — e não antes.

      `loadMore()` já se protege contra pedidos simultâneos e duplicatas, então
      este efeito pode disparar sem medo de consultas repetidas.

      O foco NÃO é movido por este efeito: só pedimos dados. A grade continua
      com o mesmo `LazyGridState`, então a posição e o item focado permanecem
      onde estavam quando os novos cards chegam.
    */
    LaunchedEffect(gridState, list.size) {
        snapshotFlow {
            val info = gridState.layoutInfo
            val lastVisible = info.visibleItemsInfo.lastOrNull()?.index ?: -1
            lastVisible to list.size
        }.collect { (lastVisible, size) ->
            /*
              Lemos `hasMore` do ViewModel a cada emissão, e não do `s` capturado
              na composição: o valor do estado do Compose dentro do efeito fica
              congelado no instante em que ele começou, e depois do primeiro
              bloco carregado ele continuaria dizendo "não há mais" — o
              carregamento pararia na segunda página.
            */
            val live = vm.state.value
            if (live.hasMore && size > 0 && lastVisible >= size - 12) {
                vm.loadMore()
            }
        }
    }

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
                state = gridState,
                columns = androidx.compose.foundation.lazy.grid.GridCells.Adaptive(minSize = 150.dp),
                contentPadding = PaddingValues(horizontal = 48.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                items(list.size, key = { "${list[it].type}-${list[it].tmdbId}" }) { i ->
                    TvPosterCard(list[i], { onOpen(list[i]) }, width = 200)
                }
                /*
                  Rodapé discreto: um spinner pequeno enquanto o próximo bloco
                  chega, e o total quando o catálogo termina. Não bloqueia a
                  grade nem rouba o foco — é apenas um item a mais no fim.
                */
                if (s.hasMore) {
                    item(key = "loading-more") {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 18.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    color = MfColors.Red,
                                    strokeWidth = 2.dp,
                                )
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    "Carregando mais títulos…",
                                    color = MfColors.TextDim,
                                    fontFamily = MfSans,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                } else if (list.size > 60) {
                    item(key = "end-of-catalog") {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 18.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                "Você chegou ao fim · ${list.size} títulos",
                                color = MfColors.TextDim,
                                fontFamily = MfSans,
                                fontSize = 12.sp,
                            )
                        }
                    }
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
        // A capa vem de `FavoriteRow.posterUrl`, preenchido pelo ViewModel a
        // partir do catálogo (`/api/catalog/posters`). Antes este `Title` era
        // montado SEM `posterUrl`, então o card recebia string vazia e o Coil
        // desenhava só o fundo cinza — era exatamente o "cinza/preto" que o
        // usuário via nos Favoritos da TV.
        val titles = s.favorites.map {
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

/**
 * Planos — a rota /planos do site, com os descontos de 3 meses e 1 ano.
 *
 * Cada plano tem o botão "Assinar pelo WhatsApp", acionável pelo controle
 * remoto (D-pad até o botão + OK). O link vem pronto do servidor
 * (`whatsapp_url` de cada período), com o e-mail da conta, o plano, a duração
 * e o valor na mensagem — o mesmo texto que o site monta em
 * `server/routes/plans.js`. O app não remonta a mensagem para não divergir.
 */
@Composable
fun TvPlansScreen(vm: TvViewModel) {
    val s by vm.state.collectAsState()
    val context = LocalContext.current
    LaunchedEffect(Unit) { vm.loadPlans() }

    // Período escolhido — o mesmo seletor "1 mês / 3 meses / 1 ano" do site.
    var period by remember { mutableStateOf("1m") }

    Column(Modifier.fillMaxSize()) {
        TvPageTitle("Planos")
        Text(
            "Escolha o plano e fale com a gente pelo WhatsApp.",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 14.sp,
            modifier = Modifier.padding(start = 48.dp, bottom = 14.dp),
        )

        if (s.plans.isEmpty()) {
            TvEmpty("Carregando planos…", "💳")
            return@Column
        }

        // Seletor de período — .btn--sm do site, navegável pelo D-pad.
        Row(
            modifier = Modifier.padding(start = 48.dp, bottom = 18.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            listOf("1m" to "1 mês", "3m" to "3 meses", "12m" to "1 ano").forEach { (code, label) ->
                var f by remember { mutableStateOf(false) }
                val on = period == code
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (on) MfColors.Red else MfColors.BgCard)
                        .then(
                            when {
                                f -> Modifier.border(3.dp, MfColors.RedBright, RoundedCornerShape(8.dp))
                                !on -> Modifier.border(1.dp, MfColors.Border, RoundedCornerShape(8.dp))
                                else -> Modifier
                            },
                        )
                        .onFocusChanged { f = it.isFocused }
                        .clickable { period = code }
                        .padding(horizontal = 20.dp, vertical = 10.dp),
                ) {
                    Text(
                        label,
                        color = if (on || f) Color.White else MfColors.TextSoft,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                        fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                    )
                }
            }
        }

        LazyRow(
            contentPadding = PaddingValues(horizontal = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(s.plans) { plan ->
                val chosen = plan.periods.firstOrNull { it.code == period }
                    ?: plan.periods.firstOrNull()

                Column(
                    modifier = Modifier
                        .width(340.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(MfColors.BgCard)
                        .border(1.dp, MfColors.Border, RoundedCornerShape(16.dp))
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
                        chosen?.priceLabel ?: plan.priceLabel,
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

                    Spacer(Modifier.height(16.dp))

                    // Botão de contratação — foco evidente para o controle remoto.
                    val waUrl = chosen?.whatsappUrl.orEmpty()
                    var btnFocused by remember { mutableStateOf(false) }
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(
                                when {
                                    waUrl.isBlank() -> MfColors.BgHover
                                    btnFocused -> MfColors.RedBright
                                    else -> MfColors.Red
                                },
                            )
                            .then(
                                if (btnFocused) {
                                    Modifier.border(3.dp, Color.White, RoundedCornerShape(10.dp))
                                } else Modifier,
                            )
                            .onFocusChanged { btnFocused = it.isFocused }
                            .clickable(enabled = waUrl.isNotBlank()) {
                                openExternal(context, waUrl)
                            }
                            .padding(vertical = 14.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Assinar pelo WhatsApp",
                            color = if (waUrl.isBlank()) MfColors.TextDim else Color.White,
                            fontFamily = MfSans,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(20.dp))

        // Contato direto — o painel "Falar com a gente" do site.
        var contactFocused by remember { mutableStateOf(false) }
        Box(
            modifier = Modifier
                .padding(start = 48.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(if (contactFocused) MfColors.RedBright else MfColors.Red)
                .then(
                    if (contactFocused) Modifier.border(3.dp, Color.White, RoundedCornerShape(10.dp))
                    else Modifier,
                )
                .onFocusChanged { contactFocused = it.isFocused }
                .clickable {
                    openExternal(
                        context,
                        "https://wa.me/5511943750307?text=" +
                            java.net.URLEncoder.encode(
                                "Olá! Preciso de ajuda com o MovieFlix.",
                                "UTF-8",
                            ),
                    )
                }
                .padding(horizontal = 24.dp, vertical = 14.dp),
        ) {
            Text(
                "WhatsApp (11) 94375-0307",
                color = Color.White,
                fontFamily = MfSans,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

/** Abre uma URL no navegador/WhatsApp do aparelho. */
private fun openExternal(context: android.content.Context, url: String) {
    if (url.isBlank()) return
    runCatching {
        context.startActivity(
            android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
        )
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

    /*
      ── Navegação de séries ──────────────────────────────────────────────────

      Antes: `selectedSeason` começava fixo em 1. Se a série não tivesse
      temporada 1 (ou se as temporadas ainda não tivessem carregado), a lista de
      episódios ficava VAZIA e não havia como chegar aos episódios — a tela
      parecia quebrada. Além disso o botão "Assistir" lia
      `title.episodesAvailable`, campo que NÃO existe quando o título vem do
      Histórico ou dos Favoritos (lá o Title é montado na mão), então o botão
      caía sempre em T1E1 mesmo quando a série começava em outra temporada.

      Agora:
        • `selectedSeason` é nulo até as temporadas chegarem e passa a apontar
          para a PRIMEIRA temporada real da série (respeitando a ordem que o
          servidor devolve, já ordenada por season_number).
        • O botão principal mostra "Assistir — Temporada X, Episódio Y" com os
          números reais, e usa a temporada selecionada.
        • Trocar de temporada troca a lista de episódios; episódios de
          temporadas diferentes nunca se misturam, porque a lista vem de
          `season.episodes` daquela temporada.
        • Cada episódio é um item focável do LazyColumn: o D-pad desce por eles
          e OK abre o player. O foco é preservado porque a lista é a mesma
          instância enquanto a temporada não muda.
    */
    var selectedSeason by remember(title.tmdbId) { mutableStateOf<Int?>(null) }

    LaunchedEffect(title.tmdbId) { if (isSeries) vm.loadSeasons(title.tmdbId) }

    // Assim que as temporadas chegam, aponta para a primeira de verdade.
    LaunchedEffect(s.seasons, title.tmdbId) {
        if (!isSeries) return@LaunchedEffect
        val first = s.seasons.firstOrNull()?.seasonNumber
        if (first != null && s.seasons.none { it.seasonNumber == selectedSeason }) {
            selectedSeason = first
        }
    }

    val season = s.seasons.firstOrNull { it.seasonNumber == selectedSeason } ?: s.seasons.firstOrNull()
    val firstEpisode = season?.episodes?.firstOrNull()

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
                    if (isSeries && s.seasons.isNotEmpty()) {
                        Spacer(Modifier.width(14.dp))
                        Text(
                            "${s.seasons.size} temporada(s)",
                            color = MfColors.TextMuted,
                            fontFamily = MfSans,
                            fontSize = 14.sp,
                        )
                    }
                }
                Spacer(Modifier.height(20.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    if (isSeries) {
                        /*
                          Opção principal: "Assistir — Temporada X, Episódio Y".

                          Usa a temporada selecionada e o primeiro episódio dela.
                          Enquanto as temporadas carregam, cai para o primeiro
                          par de `episodes_available` (que o catálogo já traz) —
                          assim o botão nunca fica sem destino.
                        */
                        val fallback = title.episodesAvailable?.firstOrNull()
                            ?.split("/")?.mapNotNull { it.toIntOrNull() }
                        val playSeason = season?.seasonNumber ?: fallback?.getOrNull(0) ?: 1
                        val playEpisode = firstEpisode?.episodeNumber ?: fallback?.getOrNull(1) ?: 1
                        TvActionButton(
                            "▶  Assistir — Temporada $playSeason, Episódio $playEpisode",
                            primary = true,
                        ) { onPlay(playSeason, playEpisode) }
                    } else {
                        TvActionButton("▶  Assistir", primary = true) { onPlay(null, null) }
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
                    items(s.seasons, key = { "season-${it.seasonNumber}" }) { seasonItem ->
                        var focused by remember { mutableStateOf(false) }
                        val sel = seasonItem.seasonNumber == selectedSeason
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
                                .then(
                                    if (focused) Modifier.border(2.dp, Color.White, RoundedCornerShape(20.dp))
                                    else Modifier,
                                )
                                .onFocusChanged { focused = it.isFocused }
                                .clickable { selectedSeason = seasonItem.seasonNumber }
                                .padding(horizontal = 18.dp, vertical = 9.dp),
                        ) {
                            Text(
                                "Temporada ${seasonItem.seasonNumber}",
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

            /*
              Episódios da temporada selecionada.

              A chave inclui a temporada, então trocar de temporada reconstrói a
              lista com os episódios CERTOS — nunca mistura temporadas. Cada
              linha mostra número, título e imagem quando o provedor as tem.
            */
            val episodes = season?.episodes ?: emptyList()
            if (episodes.isEmpty()) {
                item {
                    Text(
                        "Esta temporada não tem episódios disponíveis.",
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(horizontal = 48.dp, vertical = 12.dp),
                    )
                }
            }
            items(episodes, key = { "s${season?.seasonNumber ?: 0}e${it.episodeNumber}" }) { ep ->
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
                        .clickable { onPlay(season?.seasonNumber ?: 1, ep.episodeNumber) }
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .width(132.dp)
                            .height(74.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(MfColors.BgCard),
                        contentAlignment = Alignment.Center,
                    ) {
                        // Sem thumbnail do provedor, mostra o número em vez de um
                        // retângulo cinza vazio.
                        Text(
                            "${ep.episodeNumber}",
                            color = MfColors.TextDim,
                            fontFamily = MfSans,
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        if (!ep.thumbnailUrl.isNullOrBlank()) {
                            AsyncImage(
                                model = ep.thumbnailUrl,
                                contentDescription = ep.title,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                    }
                    Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "${ep.episodeNumber}. ${ep.title.ifBlank { "Episódio ${ep.episodeNumber}" }}",
                            color = if (focused) MfColors.Text else MfColors.TextSoft,
                            fontFamily = MfSans,
                            fontSize = 15.sp,
                            fontWeight = if (focused) FontWeight.Bold else FontWeight.Medium,
                        )
                        Text(
                            buildString {
                                append("T${season?.seasonNumber ?: 1} E${ep.episodeNumber}")
                                if (ep.durationSeconds != null) append(" · ${ep.durationSeconds / 60} min")
                            },
                            color = MfColors.TextDim,
                            fontFamily = MfSans,
                            fontSize = 12.sp,
                        )
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
    /*
      Botão de olho da senha.

      Na TV não existe toque: o controle remoto navega por FOCO. Por isso o olho
      é um elemento focável de verdade (um Box com onFocusChanged + clickable),
      e não um ícone decorativo dentro do campo. Com o D-pad a pessoa desce do
      campo de senha até o olho, aperta OK e a senha aparece; aperta OK de novo
      e volta a esconder.

      A senha começa escondida e o olho só aparece depois que algo foi digitado.
      Nada muda na autenticação — o valor enviado é o mesmo de antes.
    */
    var showPass by remember { mutableStateOf(false) }
    var eyeFocused by remember { mutableStateOf(false) }
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

        Row(
            modifier = Modifier.width(520.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = pass,
                onValueChange = { pass = it },
                label = { Text("Senha") },
                singleLine = true,
                visualTransformation = if (showPass) VisualTransformation.None
                else PasswordVisualTransformation(),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MfColors.Red,
                    unfocusedBorderColor = MfColors.Border,
                    focusedContainerColor = MfColors.BgCard,
                    unfocusedContainerColor = MfColors.BgCard,
                    focusedTextColor = MfColors.Text,
                    unfocusedTextColor = MfColors.Text,
                ),
                modifier = Modifier.weight(1f),
            )

            if (pass.isNotEmpty()) {
                Spacer(Modifier.width(10.dp))
                Box(
                    modifier = Modifier
                        .size(52.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(
                            when {
                                eyeFocused -> MfColors.Red
                                showPass -> MfColors.RedDark
                                else -> MfColors.BgCard
                            },
                        )
                        .then(
                            if (eyeFocused) Modifier.border(2.dp, Color.White, RoundedCornerShape(10.dp))
                            else Modifier.border(1.dp, MfColors.Border, RoundedCornerShape(10.dp)),
                        )
                        .onFocusChanged { eyeFocused = it.isFocused }
                        .clickable { showPass = !showPass },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (showPass) "\uD83D\uDE48" else "\uD83D\uDC41",
                        fontSize = 20.sp,
                        color = Color.White,
                    )
                }
            }
        }
        Spacer(Modifier.height(22.dp))

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
            TvSettingRow("Versão", "MovieFlix TV 1.0.2")
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

/**
 * Perfis — a rota /perfil do site.
 *
 * O site usa UM perfil por conta (tabela `profiles`), não vários perfis por
 * assinatura como a Netflix. Então mostramos o perfil real da conta logada e
 * o estado de acesso dela — não inventamos perfis que não existem no banco.
 */
@Composable
fun TvProfilesScreen(vm: TvViewModel, onLogin: () -> Unit) {
    val s by vm.state.collectAsState()

    Column(Modifier.fillMaxSize().padding(48.dp)) {
        TvPageTitle("Perfis")
        Spacer(Modifier.height(8.dp))

        if (!s.loggedIn) {
            Text(
                "Entre na sua conta para gerenciar perfis.",
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
                .border(2.dp, MfColors.Red, RoundedCornerShape(16.dp))
                .padding(24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .width(72.dp)
                    .height(72.dp)
                    .clip(RoundedCornerShape(36.dp))
                    .background(MfColors.Red),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    (s.email ?: "?").trim().firstOrNull()?.uppercase() ?: "?",
                    color = Color.White,
                    fontFamily = MfSans,
                    fontSize = 30.sp,
                    fontWeight = FontWeight.Black,
                )
            }
            Spacer(Modifier.width(22.dp))
            Column {
                Text(
                    s.email ?: "",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 19.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Perfil principal",
                    color = MfColors.TextMuted,
                    fontFamily = MfSans,
                    fontSize = 14.sp,
                )
            }
        }

        Spacer(Modifier.height(24.dp))
        Text(
            "O MovieFlix usa um perfil por conta. Para assistir em outra pessoa, " +
                "use outra conta — favoritos e histórico são compartilhados entre " +
                "site, celular e TV.",
            color = MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 14.sp,
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
