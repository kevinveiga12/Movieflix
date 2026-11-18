package run.velixir.movieflix.ui

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import run.velixir.movieflix.R
import run.velixir.movieflix.data.Title
import run.velixir.movieflix.ui.theme.MfBrand
import run.velixir.movieflix.ui.theme.MfColors
import run.velixir.movieflix.ui.theme.MfHeroTitle
import run.velixir.movieflix.ui.theme.MfSans
import run.velixir.movieflix.ui.theme.MfSectionTitle

/* ==========================================================================
   Componentes do app mobile — mesma linguagem visual do site.

   Tudo aqui foi copiado de src/styles/global.css, não inventado:

     .nav-brand img     34x34, raio 8
     .nav-brand span    Bebas Neue, gradiente branco 30% → vermelho
     .card              raio 12, fundo #17171f, hover translateY(-6) scale(1.04)
                        com anel vermelho
     .card-poster       2:3, degradê de fundo
     .card-badge        canto sup. esq., vermelho, raio 5, 0.62rem
     .card-rating       canto sup. dir., preto 75%, cor de aviso
     .card-info         padding 10/11/12
     .card-title        0.84rem, peso 600, 2 linhas
     .card-sub          0.72rem, cor apagada
     .card-progress     3px na base, vermelho
     .hero-bg::after    90deg 0.97 → 0.75@42% → transparente@78%
     .badge--red        fundo vermelho
     .badge--purple     roxo 22% + texto #c4b5fd
     .section-title      barrinha 4px degradê vermelho→roxo
   ========================================================================== */

/**
 * Logo MovieFlix — a MESMA do site.
 *
 * O ícone é o arquivo real `public/icon-192.png` do site, empacotado em
 * res/drawable-nodpi/logo.png (copiado, não redesenhado). O texto ao lado usa
 * Bebas Neue com o gradiente branco→vermelho do `.nav-brand span`.
 */
@Composable
fun MfLogo(
    fontSize: Int = 24,
    iconSize: Int = 30,
    showWordmark: Boolean = true,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        androidx.compose.foundation.Image(
            painter = painterResource(R.drawable.logo),
            contentDescription = "MovieFlix",
            modifier = Modifier
                .size(iconSize.dp)
                .clip(RoundedCornerShape(8.dp)),
        )
        if (showWordmark) {
            Spacer(Modifier.width(9.dp))
            Text(
                text = "MOVIEFLIX",
                style = MfBrand.copy(fontSize = fontSize.sp),
                color = MfColors.Red,
            )
        }
    }
}

/** Barrinha vertical em degradê que precede todo título de seção no site. */
@Composable
fun MfSectionBar(height: Int = 17) {
    Box(
        Modifier
            .width(4.dp)
            .height(height.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(Brush.verticalGradient(listOf(MfColors.Red, MfColors.Purple))),
    )
}

/** Título de seção no padrão do site: barrinha + Inter Bold. */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, trailing: String? = null) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        MfSectionBar()
        Text(text, style = MfSectionTitle, color = MfColors.Text)
        if (trailing != null) {
            Spacer(Modifier.weight(1f))
            Text(trailing, color = MfColors.TextDim, fontFamily = MfSans, fontSize = 11.sp)
        }
    }
}

/**
 * Card de pôster — o `.card` do site.
 *
 * Proporção 2:3, raio 12, fundo #17171f, selo de qualidade vermelho no canto
 * superior esquerdo, nota no direito, título em 2 linhas e barra de progresso
 * na base quando o título está em "continuar assistindo".
 */
@Composable
fun PosterCard(
    title: Title,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    width: Int = 132,
    progress: Double? = null,
) {
    Column(
        modifier = modifier
            .width(width.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MfColors.BgCard)
            .clickable(onClick = onClick),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .background(
                    Brush.linearGradient(listOf(Color(0xFF1A1A24), Color(0xFF0F0F16))),
                ),
        ) {
            AsyncImage(
                model = title.posterUrl,
                contentDescription = title.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )

            // Selo de qualidade — o .card-badge do site.
            if (title.quality.isNotBlank()) {
                Text(
                    text = title.quality.uppercase(),
                    color = Color.White,
                    fontFamily = MfSans,
                    fontSize = 8.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 0.4.sp,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                        .background(MfColors.Red.copy(alpha = 0.95f), RoundedCornerShape(5.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }

            // Nota — o .card-rating do site.
            if (title.voteAverage != null && title.voteAverage > 0) {
                Text(
                    text = "★ ${title.ratingLabel}",
                    color = MfColors.Warning,
                    fontFamily = MfSans,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(5.dp))
                        .padding(horizontal = 5.dp, vertical = 2.dp),
                )
            }

            // Barra de progresso — o .card-progress do site.
            if (progress != null && progress > 0) {
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
        }

        // .card-info do site: padding 10/11/12.
        Column(Modifier.padding(start = 11.dp, end = 11.dp, top = 9.dp, bottom = 11.dp)) {
            Text(
                text = title.title,
                color = MfColors.Text,
                fontFamily = MfSans,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                lineHeight = 15.sp,
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = buildString {
                    if (title.year.isNotBlank()) append(title.year)
                    if (title.isSeries && title.seasons != null) {
                        if (isNotEmpty()) append(" · ")
                        append("${title.seasons}T")
                    }
                },
                color = MfColors.TextMuted,
                fontFamily = MfSans,
                fontSize = 10.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Fileira horizontal com título de seção — o padrão do site. */
@Composable
fun TitleRow(
    heading: String,
    items: List<Title>,
    onItemClick: (Title) -> Unit,
    cardWidth: Int = 132,
) {
    if (items.isEmpty()) return
    Column(modifier = Modifier.padding(bottom = 20.dp)) {
        SectionTitle(heading)
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(items, key = { "${it.type}-${it.tmdbId}" }) { t ->
                PosterCard(title = t, onClick = { onItemClick(t) }, width = cardWidth)
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
    header: (@Composable () -> Unit)? = null,
) {
    androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
        columns = androidx.compose.foundation.lazy.grid.GridCells.Adaptive(minSize = 104.dp),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = modifier,
    ) {
        if (header != null) {
            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                header()
            }
        }
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
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            MfLogo(fontSize = 26, iconSize = 40)
            Spacer(Modifier.height(20.dp))
            CircularProgressIndicator(color = MfColors.Red, strokeWidth = 2.dp)
        }
    }
}

@Composable
fun ErrorBox(message: String, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp),
        ) {
            MfLogo(fontSize = 24, iconSize = 36)
            Spacer(Modifier.height(18.dp))
            Text(
                message,
                color = MfColors.TextMuted,
                fontFamily = MfSans,
                fontSize = 13.sp,
                lineHeight = 19.sp,
            )
            Spacer(Modifier.height(16.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(MfColors.Red)
                    .clickable(onClick = onRetry)
                    .padding(horizontal = 22.dp, vertical = 10.dp),
            ) {
                Text(
                    "Tentar novamente",
                    color = Color.White,
                    fontFamily = MfSans,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                )
            }
        }
    }
}

/**
 * Faixa de destaque no topo da home — o `.hero` do site.
 *
 * Imagem de fundo com o degradê exato do `.hero-bg::after` (escuro à esquerda
 * onde fica o texto, transparente à direita), selos vermelho e roxo, título em
 * Bebas Neue caixa alta e o botão "Assistir" vermelho.
 */
@Composable
fun HeroBanner(
    title: Title?,
    onPlay: () -> Unit,
    onDetails: () -> Unit,
) {
    if (title == null) return
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(430.dp),
    ) {
        AsyncImage(
            model = title.backdropUrl.ifBlank { title.posterUrl },
            contentDescription = title.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )

        // Degradê horizontal do site: 0.97 → 0.75@42% → transparente@78%.
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
                        0f to MfColors.Bg.copy(alpha = 0.97f),
                        0.42f to MfColors.Bg.copy(alpha = 0.75f),
                        0.78f to Color.Transparent,
                        1f to Color.Transparent,
                    ),
                ),
        )
        // Degradê vertical fechando no fundo da página.
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color.Transparent,
                        0.55f to MfColors.Bg.copy(alpha = 0.30f),
                        1f to MfColors.Bg,
                    ),
                ),
        )

        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 16.dp, end = 16.dp, bottom = 20.dp),
        ) {
            // Selos do site: vermelho (destaque) e roxo (categoria).
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(
                    "DESTAQUE",
                    color = Color.White,
                    fontFamily = MfSans,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.5.sp,
                    modifier = Modifier
                        .background(MfColors.Red, RoundedCornerShape(6.dp))
                        .padding(horizontal = 9.dp, vertical = 3.dp),
                )
                if (title.category.isNotBlank()) {
                    Text(
                        title.category.split(",").first().trim().uppercase(),
                        color = Color(0xFFC4B5FD),
                        fontFamily = MfSans,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.5.sp,
                        modifier = Modifier
                            .background(MfColors.Purple.copy(alpha = 0.22f), RoundedCornerShape(6.dp))
                            .border(1.dp, MfColors.Purple.copy(alpha = 0.4f), RoundedCornerShape(6.dp))
                            .padding(horizontal = 9.dp, vertical = 3.dp),
                    )
                }
            }

            Spacer(Modifier.height(11.dp))

            // Título em Bebas Neue, caixa alta — o .hero-title do site.
            Text(
                text = title.title.uppercase(),
                style = MfHeroTitle.copy(fontSize = 34.sp, lineHeight = 33.sp),
                color = Color.White,
                maxLines = 2,
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
                    Spacer(Modifier.width(11.dp))
                }
                Text(title.year, color = MfColors.TextSoft, fontFamily = MfSans, fontSize = 12.sp)
                if (title.quality.isNotBlank()) {
                    Spacer(Modifier.width(11.dp))
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
            }

            Spacer(Modifier.height(14.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(MfColors.Red)
                        .clickable(onClick = onPlay)
                        .padding(horizontal = 24.dp, vertical = 11.dp),
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
                        .background(Color.White.copy(alpha = 0.12f))
                        .clickable(onClick = onDetails)
                        .padding(horizontal = 18.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Mais informações",
                        color = Color.White,
                        fontFamily = MfSans,
                        fontWeight = FontWeight.Medium,
                        fontSize = 13.sp,
                    )
                }
            }
        }
    }
}

/** Chip de gênero — o `.chip` do site. */
@Composable
fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) MfColors.Red else MfColors.BgCard)
            .border(
                1.dp,
                if (selected) Color.Transparent else MfColors.Border,
                RoundedCornerShape(20.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 7.dp),
    ) {
        Text(
            label,
            color = if (selected) Color.White else MfColors.TextSoft,
            fontFamily = MfSans,
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
        )
    }
}

/** Card largo 16:9 de "continuar assistindo" — o `.card--wide` do site. */
@Composable
fun WideCard(
    title: String,
    imageUrl: String,
    progress: Double,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .width(230.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MfColors.BgCard)
            .clickable(onClick = onClick),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .background(MfColors.BgHover),
        ) {
            AsyncImage(
                model = imageUrl,
                contentDescription = title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            // Botão de play circular no centro, como o .card-play do site.
            Box(
                Modifier
                    .align(Alignment.Center)
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(MfColors.Red.copy(alpha = 0.95f)),
                contentAlignment = Alignment.Center,
            ) {
                Text("▶", color = Color.White, fontSize = 13.sp)
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
        Text(
            title,
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 11.dp, vertical = 9.dp),
        )
    }
}

@Composable
fun EmptyState(text: String, icon: String = "🎬") {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp),
        ) {
            Text(icon, fontSize = 34.sp)
            Spacer(Modifier.height(12.dp))
            Text(
                text,
                color = MfColors.TextMuted,
                fontFamily = MfSans,
                fontSize = 13.sp,
                lineHeight = 19.sp,
            )
        }
    }
}

@Composable
fun SpacerH(h: Int) = Spacer(Modifier.height(h.dp))

@Composable
fun SpacerW(w: Int) = Spacer(Modifier.width(w.dp))
