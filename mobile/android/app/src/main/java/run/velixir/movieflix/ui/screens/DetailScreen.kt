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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import run.velixir.movieflix.AppViewModel
import run.velixir.movieflix.data.Title
import run.velixir.movieflix.ui.theme.MfColors

/**
 * Detalhe do título. Para séries, carrega temporadas e episódios da MESMA API
 * do site (/api/db/series/:id/episodes) — nada é duplicado no app.
 */
@Composable
fun DetailScreen(
    vm: AppViewModel,
    title: Title,
    onPlay: (season: Int?, episode: Int?) -> Unit,
    onBack: () -> Unit,
) {
    val s by vm.state.collectAsState()
    val isSeries = title.isSeries

    LaunchedEffect(title.tmdbId) {
        if (isSeries) vm.loadSeasons(title.tmdbId)
    }

    var selectedSeason by androidx.compose.runtime.remember {
        androidx.compose.runtime.mutableStateOf(1)
    }

    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(240.dp),
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
                                listOf(Color.Transparent, MfColors.Bg.copy(alpha = 0.8f), MfColors.Bg),
                            ),
                        ),
                )
                Text(
                    "‹ Voltar",
                    color = Color.White,
                    fontSize = 14.sp,
                    modifier = Modifier
                        .padding(16.dp)
                        .clickable(onClick = onBack),
                )
            }
        }

        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text(
                    title.title,
                    color = MfColors.Text,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Black,
                )
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("★ ${title.ratingLabel}", color = MfColors.Warning, fontSize = 12.sp)
                    Spacer(Modifier.width(10.dp))
                    Text(title.year, color = MfColors.TextMuted, fontSize = 12.sp)
                    Spacer(Modifier.width(10.dp))
                    Text(title.quality, color = MfColors.TextMuted, fontSize = 12.sp)
                    if (title.duration != null) {
                        Spacer(Modifier.width(10.dp))
                        Text("${title.duration} min", color = MfColors.TextMuted, fontSize = 12.sp)
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(MfColors.Red)
                            .clickable {
                                if (isSeries) {
                                    val first = title.episodesAvailable?.firstOrNull()
                                    val parts = first?.split("/")?.mapNotNull { it.toIntOrNull() }
                                    onPlay(parts?.getOrNull(0) ?: 1, parts?.getOrNull(1) ?: 1)
                                } else {
                                    onPlay(null, null)
                                }
                            }
                            .padding(horizontal = 26.dp, vertical = 11.dp),
                    ) {
                        Text("▶  Assistir", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(MfColors.BgCard)
                            .clickable { vm.toggleFavorite(title) }
                            .padding(horizontal = 18.dp, vertical = 11.dp),
                    ) {
                        Text(
                            if (vm.isFavorite(title.tmdbId)) "♥ Favorito" else "♡ Favoritar",
                            color = MfColors.TextSoft,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
                Spacer(Modifier.height(16.dp))
                if (title.description.isNotBlank()) {
                    Text(
                        title.description,
                        color = MfColors.TextMuted,
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                    )
                }
                Spacer(Modifier.height(20.dp))
            }
        }

        if (isSeries && s.seasons.isNotEmpty()) {
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(s.seasons) { season ->
                        val sel = season.seasonNumber == selectedSeason
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(20.dp))
                                .background(if (sel) MfColors.Red else MfColors.BgCard)
                                .clickable { selectedSeason = season.seasonNumber }
                                .padding(horizontal = 14.dp, vertical = 7.dp),
                        ) {
                            Text(
                                "Temporada ${season.seasonNumber}",
                                color = if (sel) Color.White else MfColors.TextMuted,
                                fontSize = 12.sp,
                                fontWeight = if (sel) FontWeight.Bold else FontWeight.Normal,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))
            }

            val season = s.seasons.firstOrNull { it.seasonNumber == selectedSeason }
            items(season?.episodes ?: emptyList()) { ep ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPlay(selectedSeason, ep.episodeNumber) }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .width(96.dp)
                            .height(56.dp)
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
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "${ep.episodeNumber}. ${ep.title}",
                            color = MfColors.TextSoft,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 2,
                        )
                        if (ep.durationSeconds != null) {
                            Text(
                                "${ep.durationSeconds / 60} min",
                                color = MfColors.TextDim,
                                fontSize = 11.sp,
                            )
                        }
                    }
                    Text("▶", color = MfColors.Red, fontSize = 16.sp)
                }
            }
        }

        item { Spacer(Modifier.height(30.dp)) }
    }
}
