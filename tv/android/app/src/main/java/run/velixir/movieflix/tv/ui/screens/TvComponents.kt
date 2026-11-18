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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import run.velixir.movieflix.tv.TvViewModel
import run.velixir.movieflix.tv.data.Title
import run.velixir.movieflix.tv.ui.theme.MfColors

/**
 * Card de pôster para TV.
 *
 * Foco é o coração da experiência em TV: o card ganha borda vermelha, escala
 * e sombra quando recebe foco do D-pad. Sem isso o usuário se perde — por isso
 * o destaque é grande e óbvio, não um contorno fino.
 */
@Composable
fun TvPosterCard(
    title: Title,
    onClick: () -> Unit,
    width: Int = 150,
) {
    var focused by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .width(width.dp)
            .onFocusChanged { focused = it.isFocused }
            .clickable(onClick = onClick)
            .padding(4.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(10.dp))
                .background(MfColors.BgCard)
                .then(
                    if (focused) {
                        Modifier.border(3.dp, MfColors.Red, RoundedCornerShape(10.dp))
                    } else {
                        Modifier.border(1.dp, MfColors.Border, RoundedCornerShape(10.dp))
                    },
                ),
        ) {
            AsyncImage(
                model = title.posterUrl,
                contentDescription = title.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (title.quality.isNotBlank()) {
                Text(
                    title.quality,
                    color = Color.White,
                    fontSize = 10.sp,
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
            title.title,
            color = if (focused) MfColors.Text else MfColors.TextMuted,
            fontSize = 13.sp,
            fontWeight = if (focused) FontWeight.Bold else FontWeight.Normal,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            lineHeight = 16.sp,
        )
    }
}

/** Fileira horizontal de conteúdos, com título de seção grande. */
@Composable
fun TvRow(
    heading: String,
    items: List<Title>,
    onItemClick: (Title) -> Unit,
) {
    if (items.isEmpty()) return
    Column(Modifier.padding(bottom = 22.dp)) {
        Text(
            heading,
            color = MfColors.Text,
            fontSize = 20.sp,
            fontWeight = FontWeight.Black,
            modifier = Modifier.padding(start = 48.dp, bottom = 12.dp),
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(items, key = { "${it.type}-${it.tmdbId}" }) { t ->
                TvPosterCard(t) { onItemClick(t) }
            }
        }
    }
}

/** Menu lateral fixo — navegação principal da TV. */
@Composable
fun TvSidebar(
    current: String,
    onSelect: (String) -> Unit,
    email: String?,
) {
    val items = listOf(
        "home" to "Início",
        "movies" to "Filmes",
        "series" to "Séries",
        "search" to "Buscar",
        "favorites" to "Favoritos",
        "account" to "Conta",
    )

    Column(
        modifier = Modifier
            .width(190.dp)
            .fillMaxHeight()
            .background(MfColors.BgElev)
            .padding(vertical = 28.dp),
    ) {
        Text(
            "MOVIEFLIX",
            color = MfColors.Red,
            fontSize = 22.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 1.sp,
            modifier = Modifier.padding(start = 24.dp, bottom = 28.dp),
        )

        items.forEach { (key, label) ->
            var focused by remember { mutableStateOf(false) }
            val active = current == key
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 3.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(
                        when {
                            focused -> MfColors.Red
                            active -> MfColors.BgHover
                            else -> Color.Transparent
                        },
                    )
                    .onFocusChanged { focused = it.isFocused }
                    .clickable { onSelect(key) }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Text(
                    label,
                    color = if (focused || active) Color.White else MfColors.TextMuted,
                    fontSize = 15.sp,
                    fontWeight = if (focused || active) FontWeight.Bold else FontWeight.Normal,
                )
            }
        }

        Spacer(Modifier.weight(1f))
        if (email != null) {
            Text(
                email,
                color = MfColors.TextDim,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 24.dp),
            )
        }
    }
}

/** Banner de destaque grande, cinematográfico. */
@Composable
fun TvHero(title: Title?, onPlay: () -> Unit) {
    if (title == null) return
    var focused by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
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
                    Brush.horizontalGradient(
                        listOf(MfColors.Bg, MfColors.Bg.copy(alpha = 0.55f), Color.Transparent),
                    ),
                ),
        )
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(Color.Transparent, MfColors.Bg.copy(alpha = 0.9f)),
                    ),
                ),
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 48.dp, bottom = 28.dp)
                .width(520.dp),
        ) {
            Text(
                title.title,
                color = Color.White,
                fontSize = 34.sp,
                fontWeight = FontWeight.Black,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                lineHeight = 38.sp,
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("★ ${title.ratingLabel}", color = MfColors.Warning, fontSize = 14.sp)
                Spacer(Modifier.width(12.dp))
                Text(title.year, color = MfColors.TextMuted, fontSize = 14.sp)
                Spacer(Modifier.width(12.dp))
                Text(title.quality, color = MfColors.TextMuted, fontSize = 14.sp)
            }
            Spacer(Modifier.height(16.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (focused) MfColors.RedBright else MfColors.Red)
                    .then(
                        if (focused) Modifier.border(2.dp, Color.White, RoundedCornerShape(8.dp))
                        else Modifier,
                    )
                    .onFocusChanged { focused = it.isFocused }
                    .clickable(onClick = onPlay)
                    .padding(horizontal = 30.dp, vertical = 13.dp),
            ) {
                Text("▶  Assistir", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }
    }
}

@Composable
fun TvLoading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        androidx.compose.material3.CircularProgressIndicator(color = MfColors.Red)
    }
}

@Composable
fun TvError(message: String, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(message, color = MfColors.TextMuted, fontSize = 16.sp)
            Spacer(Modifier.height(16.dp))
            var focused by remember { mutableStateOf(false) }
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (focused) MfColors.Red else MfColors.BgCard)
                    .onFocusChanged { focused = it.isFocused }
                    .clickable(onClick = onRetry)
                    .padding(horizontal = 24.dp, vertical = 12.dp),
            ) {
                Text("Tentar novamente", color = Color.White, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun TvEmpty(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, color = MfColors.TextMuted, fontSize = 16.sp)
    }
}
