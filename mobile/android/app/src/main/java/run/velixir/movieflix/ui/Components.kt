package run.velixir.movieflix.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import run.velixir.movieflix.data.Title
import run.velixir.movieflix.ui.theme.MfColors

/** Card de pôster — mesma proporção 2:3 do site. */
@Composable
fun PosterCard(
    title: Title,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    width: Int = 118,
) {
    Column(
        modifier = modifier
            .width(width.dp)
            .clickable(onClick = onClick),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(10.dp))
                .background(MfColors.BgCard),
        ) {
            AsyncImage(
                model = title.posterUrl,
                contentDescription = title.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (title.quality.isNotBlank()) {
                Text(
                    text = title.quality,
                    color = Color.White,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(6.dp)
                        .background(MfColors.Red, RoundedCornerShape(4.dp))
                        .padding(horizontal = 5.dp, vertical = 2.dp),
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = title.title,
            color = MfColors.TextSoft,
            fontSize = 12.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            lineHeight = 15.sp,
        )
    }
}

/** Fileira horizontal com título de seção — o padrão do site. */
@Composable
fun TitleRow(
    heading: String,
    items: List<Title>,
    onItemClick: (Title) -> Unit,
) {
    if (items.isEmpty()) return
    Column(modifier = Modifier.padding(bottom = 18.dp)) {
        Text(
            text = heading,
            color = MfColors.Text,
            fontSize = 17.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 16.dp, bottom = 10.dp),
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(items, key = { "${it.type}-${it.tmdbId}" }) { t ->
                PosterCard(title = t, onClick = { onItemClick(t) })
            }
        }
    }
}

/** Grade de pôsteres para as telas de catálogo. */
@Composable
fun PosterGrid(
    items: List<Title>,
    onItemClick: (Title) -> Unit,
    modifier: Modifier = Modifier,
) {
    androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
        columns = androidx.compose.foundation.lazy.grid.GridCells.Adaptive(minSize = 108.dp),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = modifier,
    ) {
        items(items.size, key = { "${items[it].type}-${items[it].tmdbId}" }) { i ->
            PosterCard(
                title = items[i],
                onClick = { onItemClick(items[i]) },
                modifier = Modifier.fillMaxWidth(),
                width = 200,
            )
        }
    }
}

@Composable
fun LoadingBox() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = MfColors.Red)
    }
}

@Composable
fun ErrorBox(message: String, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(message, color = MfColors.TextMuted, fontSize = 14.sp)
            Spacer(Modifier.height(12.dp))
            Text(
                "Tentar novamente",
                color = MfColors.Red,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(onClick = onRetry)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
    }
}

/** Faixa de destaque no topo da home, com degradê para o fundo. */
@Composable
fun HeroBanner(title: Title?, onPlay: () -> Unit) {
    if (title == null) return
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
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(Color.Transparent, MfColors.Bg.copy(alpha = 0.75f), MfColors.Bg),
                    ),
                ),
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(16.dp),
        ) {
            Text(
                text = title.title,
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Black,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("★ ${title.ratingLabel}", color = MfColors.Warning, fontSize = 12.sp)
                Spacer(Modifier.width(10.dp))
                Text(title.year, color = MfColors.TextMuted, fontSize = 12.sp)
                if (title.category.isNotBlank()) {
                    Spacer(Modifier.width(10.dp))
                    Text(
                        title.category.split(",").first().trim(),
                        color = MfColors.TextMuted,
                        fontSize = 12.sp,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(MfColors.Red)
                    .clickable(onClick = onPlay)
                    .padding(horizontal = 22.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("▶  Assistir", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            }
        }
    }
}

@Composable
fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) MfColors.Red else MfColors.BgCard)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 7.dp),
    ) {
        Text(
            label,
            color = if (selected) Color.White else MfColors.TextMuted,
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
        )
    }
}

@Composable
fun SectionTitle(text: String) {
    Text(
        text = text,
        color = MfColors.Text,
        fontSize = 20.sp,
        fontWeight = FontWeight.Black,
        modifier = Modifier.padding(16.dp),
    )
}

@Composable
fun EmptyState(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, color = MfColors.TextMuted, fontSize = 14.sp)
    }
}

@Composable
fun SpacerH(h: Int) = Spacer(Modifier.height(h.dp))

@Composable
fun SpacerW(w: Int) = Spacer(Modifier.width(w.dp))

@Composable
fun Dot(color: Color, size: Int = 6) {
    Box(
        Modifier
            .size(size.dp)
            .clip(RoundedCornerShape(50))
            .background(color),
    )
}
