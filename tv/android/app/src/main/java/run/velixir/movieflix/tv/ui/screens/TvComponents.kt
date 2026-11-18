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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import run.velixir.movieflix.tv.data.Title
import run.velixir.movieflix.tv.ui.theme.MfBrand
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfDisplay
import run.velixir.movieflix.tv.ui.theme.MfHeroTitle
import run.velixir.movieflix.tv.ui.theme.MfSans
import run.velixir.movieflix.tv.ui.theme.MfSectionTitle

/**
 * Componentes da TV com a MESMA linguagem visual do site.
 *
 * O que foi copiado do site (src/styles/global.css):
 *  - logo em Bebas Neue, caixa alta, vermelho #df0a15, letter-spacing largo
 *  - título de seção com a barrinha vertical em degradê vermelho→roxo
 *  - card 2:3, raio 10, fundo #17171f, hover/foco com anel vermelho e elevação
 *  - selo de qualidade vermelho no canto do pôster
 *  - hero com degradê horizontal da esquerda (como .hero-bg::after)
 *  - botão "Assistir" vermelho com o triângulo
 */

/** Barrinha vertical em degradê que precede todo título de seção no site. */
@Composable
fun MfSectionBar(height: Int = 20) {
    Box(
        Modifier
            .width(4.dp)
            .height(height.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(
                Brush.verticalGradient(listOf(MfColors.Red, MfColors.Purple)),
            ),
    )
}

/** Título de seção no padrão do site: barrinha + texto Inter Bold. */
@Composable
fun MfSectionHeading(text: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        MfSectionBar()
        Text(text, style = MfSectionTitle, color = MfColors.Text)
    }
}

/** Logo MovieFlix — Bebas Neue, caixa alta, vermelho, como o .brand-word. */
@Composable
fun MfLogo(fontSize: Int = 30) {
    Text(
        text = "MOVIEFLIX",
        style = MfBrand.copy(fontSize = fontSize.sp),
        color = MfColors.Red,
    )
}

/**
 * Card de pôster para TV.
 *
 * Foco é o coração da experiência em TV: o card ganha anel vermelho, escala e
 * sombra quando recebe foco do D-pad — igual ao .card:hover do site, que faz
 * translateY(-6px) scale(1.04) com box-shadow e anel vermelho.
 */
@Composable
fun TvPosterCard(
    title: Title,
    onClick: () -> Unit,
    width: Int = 168,
) {
    var focused by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .width(width.dp)
            .onFocusChanged { focused = it.isFocused }
            .clickable(onClick = onClick)
            .padding(6.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(10.dp))
                .background(MfColors.BgCard)
                .then(
                    if (focused) {
                        Modifier
                            .border(3.dp, MfColors.Red, RoundedCornerShape(10.dp))
                            .background(MfColors.BgHover)
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
            // Selo de qualidade — o mesmo badge vermelho do site.
            if (title.quality.isNotBlank()) {
                Text(
                    title.quality,
                    color = Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = MfSans,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(7.dp)
                        .background(MfColors.Red, RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }
        Spacer(Modifier.height(7.dp))
        Text(
            title.title,
            color = if (focused) MfColors.Text else MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 13.sp,
            fontWeight = if (focused) FontWeight.Bold else FontWeight.Normal,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            lineHeight = 16.sp,
        )
    }
}

/** Fileira horizontal de conteúdos, com o título de seção do site. */
@Composable
fun TvRow(
    heading: String,
    items: List<Title>,
    onItemClick: (Title) -> Unit,
) {
    if (items.isEmpty()) return
    Column(Modifier.padding(bottom = 26.dp)) {
        MfSectionHeading(
            heading,
            modifier = Modifier.padding(start = 48.dp, bottom = 14.dp),
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(items, key = { "${it.type}-${it.tmdbId}" }) { t ->
                TvPosterCard(t, onClick = { onItemClick(t) })
            }
        }
    }
}

/** Menu lateral fixo — navegação principal da TV, com o logo do site. */
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
            .width(210.dp)
            .fillMaxHeight()
            .background(MfColors.BgElev)
            .padding(vertical = 30.dp),
    ) {
        MfLogo(fontSize = 30)
        Spacer(Modifier.height(4.dp))
        Text(
            "FILMES E SÉRIES",
            color = MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 9.sp,
            letterSpacing = 1.6.sp,
            modifier = Modifier.padding(start = 26.dp, bottom = 30.dp),
        )

        items.forEach { (key, label) ->
            var focused by remember { mutableStateOf(false) }
            val active = current == key
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 3.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(
                        when {
                            focused -> MfColors.Red
                            active -> MfColors.BgHover
                            else -> Color.Transparent
                        },
                    )
                    .then(
                        if (focused) Modifier.border(2.dp, MfColors.RedBright, RoundedCornerShape(8.dp))
                        else Modifier,
                    )
                    .onFocusChanged { focused = it.isFocused }
                    .clickable { onSelect(key) }
                    .padding(horizontal = 16.dp, vertical = 13.dp),
            ) {
                Text(
                    label,
                    color = if (focused || active) Color.White else MfColors.TextMuted,
                    fontFamily = MfSans,
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
                fontFamily = MfSans,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 26.dp),
            )
        }
    }
}

/**
 * Banner de destaque grande, cinematográfico.
 *
 * O degradê é o mesmo do site: escuro à esquerda (onde fica o texto) e
 * transparente à direita, mais um degradê vertical fechando no fundo.
 */
@Composable
fun TvHero(title: Title?, onPlay: () -> Unit) {
    if (title == null) return
    var focused by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(400.dp),
    ) {
        AsyncImage(
            model = title.backdropUrl.ifBlank { title.posterUrl },
            contentDescription = title.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        // Degradê horizontal do site: 97% → 75% → transparente.
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
                        0.62f to MfColors.Bg.copy(alpha = 0.35f),
                        1f to MfColors.Bg,
                    ),
                ),
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 48.dp, bottom = 34.dp)
                .width(620.dp),
        ) {
            // Selos do site: vermelho (destaque) e roxo (categoria).
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "DESTAQUE",
                    color = Color.White,
                    fontFamily = MfSans,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.6.sp,
                    modifier = Modifier
                        .background(MfColors.Red, RoundedCornerShape(6.dp))
                        .padding(horizontal = 11.dp, vertical = 4.dp),
                )
                if (title.category.isNotBlank()) {
                    Text(
                        title.category.split(",").first().trim().uppercase(),
                        color = Color(0xFFC4B5FD),
                        fontFamily = MfSans,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.6.sp,
                        modifier = Modifier
                            .background(MfColors.Purple.copy(alpha = 0.22f), RoundedCornerShape(6.dp))
                            .padding(horizontal = 11.dp, vertical = 4.dp),
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            // Título em Bebas Neue, caixa alta — o .display do site.
            Text(
                title.title.uppercase(),
                style = MfHeroTitle,
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("★ ${title.ratingLabel}", color = MfColors.Warning, fontFamily = MfSans, fontSize = 14.sp)
                Spacer(Modifier.width(14.dp))
                Text(title.year, color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 14.sp)
                if (title.quality.isNotBlank()) {
                    Spacer(Modifier.width(14.dp))
                    Text(title.quality, color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 14.sp)
                }
            }
            Spacer(Modifier.height(18.dp))
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
                    .padding(horizontal = 32.dp, vertical = 14.dp),
            ) {
                Text(
                    "▶  Assistir",
                    color = Color.White,
                    fontFamily = MfSans,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
            }
        }
    }
}

@Composable
fun TvLoading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            MfLogo(fontSize = 40)
            Spacer(Modifier.height(18.dp))
            androidx.compose.material3.CircularProgressIndicator(color = MfColors.Red)
        }
    }
}

@Composable
fun TvError(message: String, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            MfLogo(fontSize = 40)
            Spacer(Modifier.height(20.dp))
            Text(message, color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 16.sp)
            Spacer(Modifier.height(18.dp))
            var focused by remember { mutableStateOf(false) }
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (focused) MfColors.Red else MfColors.BgCard)
                    .onFocusChanged { focused = it.isFocused }
                    .clickable(onClick = onRetry)
                    .padding(horizontal = 26.dp, vertical = 13.dp),
            ) {
                Text(
                    "Tentar novamente",
                    color = Color.White,
                    fontFamily = MfSans,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
fun TvEmpty(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 16.sp)
    }
}
