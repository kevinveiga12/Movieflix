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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import run.velixir.movieflix.AppViewModel
import run.velixir.movieflix.data.Title
import run.velixir.movieflix.ui.SectionTitle
import run.velixir.movieflix.ui.theme.MfColors
import run.velixir.movieflix.ui.theme.MfHeroTitle
import run.velixir.movieflix.ui.theme.MfSans

/**
 * Detalhe do título — a rota /titulo/:type/:id e /serie/:id do site.
 *
 * Para séries, carrega temporadas e episódios da MESMA API do site
 * (/api/db/series/:id/episodes) — nada é duplicado no app.
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

    var selectedSeason by remember { mutableStateOf(1) }

    LazyColumn(Modifier.fillMaxSize()) {
        // Hero do detalhe — o .detail-hero do site.
        item {
            Box(
                modifier = Modifier
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
                                0f to Color.Black.copy(alpha = 0.35f),
                                0.45f to MfColors.Bg.copy(alpha = 0.55f),
                                1f to MfColors.Bg,
                            ),
                        ),
                )
                // Botão voltar circular, como o .back-btn do site.
                Box(
                    modifier = Modifier
                        .padding(14.dp)
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.55f))
                        .clickable(onClick = onBack),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("‹", color = Color.White, fontSize = 22.sp)
                }
            }
        }

        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                // Título em Bebas Neue caixa alta — o .display do site.
                Text(
                    title.title.uppercase(),
                    style = MfHeroTitle.copy(fontSize = 30.sp, lineHeight = 29.sp),
                    color = MfColors.Text,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(9.dp))

                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (title.voteAverage != null && title.voteAverage > 0) {
                        Text(
                            "★ ${title.ratingLabel}",
                            color = MfColors.Warning,
                            fontFamily = MfSans,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.width(10.dp))
                    }
                    Text(title.year, color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 12.sp)
                    if (title.quality.isNotBlank()) {
                        Spacer(Modifier.width(10.dp))
                        Text(
                            title.quality,
                            color = MfColors.TextSoft,
                            fontFamily = MfSans,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .border(1.dp, MfColors.BorderStrong, RoundedCornerShape(4.dp))
                                .padding(horizontal = 5.dp, vertical = 1.dp),
                        )
                    }
                    if (title.duration != null && title.duration > 0) {
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "${title.duration} min",
                            color = MfColors.TextMuted,
                            fontFamily = MfSans,
                            fontSize = 12.sp,
                        )
                    }
                    if (isSeries && title.seasons != null) {
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "${title.seasons} temporadas",
                            color = MfColors.TextMuted,
                            fontFamily = MfSans,
                            fontSize = 12.sp,
                        )
                    }
                }

                Spacer(Modifier.height(16.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    Row(
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
                            .padding(horizontal = 26.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "▶  Assistir",
                            color = Color.White,
                            fontFamily = MfSans,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                        )
                    }
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(MfColors.BgCard)
                            .border(1.dp, MfColors.Border, RoundedCornerShape(8.dp))
                            .clickable { vm.toggleFavorite(title) }
                            .padding(horizontal = 18.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (vm.isFavorite(title.tmdbId)) "♥ Favorito" else "♡ Favoritar",
                            color = MfColors.TextSoft,
                            fontFamily = MfSans,
                            fontWeight = FontWeight.Medium,
                            fontSize = 13.sp,
                        )
                    }
                }

                Spacer(Modifier.height(18.dp))

                if (title.description.isNotBlank()) {
                    Text(
                        title.description,
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 13.sp,
                        lineHeight = 20.sp,
                    )
                }
                Spacer(Modifier.height(22.dp))
            }
        }

        if (isSeries && s.seasons.isNotEmpty()) {
            item {
                SectionTitle("Temporadas")
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
                                .border(
                                    1.dp,
                                    if (sel) Color.Transparent else MfColors.Border,
                                    RoundedCornerShape(20.dp),
                                )
                                .clickable { selectedSeason = season.seasonNumber }
                                .padding(horizontal = 15.dp, vertical = 8.dp),
                        ) {
                            Text(
                                "Temporada ${season.seasonNumber}",
                                color = if (sel) Color.White else MfColors.TextSoft,
                                fontFamily = MfSans,
                                fontSize = 12.sp,
                                fontWeight = if (sel) FontWeight.Bold else FontWeight.Normal,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
            }

            val season = s.seasons.firstOrNull { it.seasonNumber == selectedSeason }
            items(season?.episodes ?: emptyList()) { ep ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPlay(selectedSeason, ep.episodeNumber) }
                        .padding(horizontal = 16.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .width(104.dp)
                            .height(60.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(MfColors.BgCard),
                    ) {
                        AsyncImage(
                            model = ep.thumbnailUrl,
                            contentDescription = ep.title,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                        Box(
                            Modifier
                                .align(Alignment.Center)
                                .size(26.dp)
                                .clip(CircleShape)
                                .background(Color.Black.copy(alpha = 0.55f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("▶", color = Color.White, fontSize = 9.sp)
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "${ep.episodeNumber}. ${ep.title}",
                            color = MfColors.TextSoft,
                            fontFamily = MfSans,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (ep.durationSeconds != null) {
                            Spacer(Modifier.height(2.dp))
                            Text(
                                "${ep.durationSeconds / 60} min",
                                color = MfColors.TextDim,
                                fontFamily = MfSans,
                                fontSize = 11.sp,
                            )
                        }
                    }
                }
            }
        }

        item { Spacer(Modifier.height(30.dp)) }
    }
}
