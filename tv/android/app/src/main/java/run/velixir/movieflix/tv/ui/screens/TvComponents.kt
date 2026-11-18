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
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import run.velixir.movieflix.tv.R
import run.velixir.movieflix.tv.data.Title
import run.velixir.movieflix.tv.ui.theme.MfBrand
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfHeroTitle
import run.velixir.movieflix.tv.ui.theme.MfSans
import run.velixir.movieflix.tv.ui.theme.MfSectionTitle

/* ==========================================================================
   Componentes da TV com a MESMA linguagem visual do site.

   Copiado de src/styles/global.css (não inventado):

     .nav-brand img      34x34, raio 8
     .nav-brand span     Bebas Neue, caixa alta, vermelho
     .card               raio 12, fundo #17171f, hover translateY(-6) scale(1.04)
                         com anel vermelho e sombra
     .card-poster        2:3, degradê de fundo
     .card-badge         canto sup. esq., vermelho, raio 5
     .card-rating        canto sup. dir., preto 75%, cor de aviso
     .card-info          padding 10/11/12
     .card-title         0.84rem, peso 600, 2 linhas
     .card-sub           0.72rem, apagado
     .card-progress      3px na base, vermelho
     .hero-bg::after     90deg 0.97 → 0.75@42% → transparente@78%
     .badge--red / --purple
     .section-title      barrinha 4px degradê vermelho→roxo
   ========================================================================== */

/** Barrinha vertical em degradê que precede todo título de seção no site. */
@Composable
fun MfSectionBar(height: Int = 20) {
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
fun MfSectionHeading(text: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        MfSectionBar()
        Text(text, style = MfSectionTitle.copy(fontSize = 19.sp), color = MfColors.Text)
    }
}

/**
 * Logo MovieFlix — a MESMA do site.
 *
 * O ícone é o arquivo real `public/icon-192.png` do site, empacotado em
 * res/drawable-nodpi/logo.png (copiado, não redesenhado). O wordmark usa
 * Bebas Neue, caixa alta, vermelho — o `.brand-word` do site.
 */
@Composable
fun MfLogo(fontSize: Int = 30, iconSize: Int = 38, showWordmark: Boolean = true) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        androidx.compose.foundation.Image(
            painter = painterResource(R.drawable.logo),
            contentDescription = "MovieFlix",
            modifier = Modifier
                .size(iconSize.dp)
                .clip(RoundedCornerShape(9.dp)),
        )
        if (showWordmark) {
            Spacer(Modifier.width(11.dp))
            Text(
                text = "MOVIEFLIX",
                style = MfBrand.copy(fontSize = fontSize.sp),
                color = MfColors.Red,
            )
        }
    }
}

/**
 * Card de pôster para TV — o `.card` do site.
 *
 * Foco é o coração da experiência em TV: o card ganha anel vermelho, escala e
 * sombra quando recebe foco do D-pad — igual ao `.card:hover` do site, que faz
 * translateY(-6px) scale(1.04) com box-shadow e anel vermelho.
 */
@Composable
fun TvPosterCard(
    title: Title,
    onClick: () -> Unit,
    width: Int = 168,
    progress: Double? = null,
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
                .clip(RoundedCornerShape(12.dp))
                .background(
                    Brush.linearGradient(listOf(Color(0xFF1A1A24), Color(0xFF0F0F16))),
                )
                .then(
                    if (focused) {
                        Modifier
                            .border(3.dp, MfColors.Red, RoundedCornerShape(12.dp))
                            .background(MfColors.BgHover)
                    } else {
                        Modifier.border(1.dp, MfColors.Border, RoundedCornerShape(12.dp))
                    },
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
                    title.quality.uppercase(),
                    color = Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = MfSans,
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
                    "★ ${title.ratingLabel}",
                    color = MfColors.Warning,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = MfSans,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(5.dp))
                        .padding(horizontal = 5.dp, vertical = 2.dp),
                )
            }

            // Botão de play no foco — o .card-play do site.
            if (focused) {
                Box(
                    Modifier
                        .align(Alignment.Center)
                        .size(46.dp)
                        .clip(CircleShape)
                        .background(MfColors.Red.copy(alpha = 0.95f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("▶", color = Color.White, fontSize = 16.sp)
                }
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

        // .card-info do site.
        Column(Modifier.padding(start = 4.dp, end = 4.dp, top = 8.dp)) {
            Text(
                title.title,
                color = if (focused) MfColors.Text else MfColors.TextSoft,
                fontFamily = MfSans,
                fontSize = 13.sp,
                fontWeight = if (focused) FontWeight.Bold else FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                lineHeight = 16.sp,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                buildString {
                    if (title.year.isNotBlank()) append(title.year)
                    if (title.isSeries && title.seasons != null) {
                        if (isNotEmpty()) append(" · ")
                        append("${title.seasons}T")
                    }
                },
                color = MfColors.TextDim,
                fontFamily = MfSans,
                fontSize = 11.sp,
                maxLines = 1,
            )
        }
    }
}

/** Fileira horizontal de conteúdos, com o título de seção do site. */
@Composable
fun TvRow(
    heading: String,
    items: List<Title>,
    onItemClick: (Title) -> Unit,
    cardWidth: Int = 168,
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
                TvPosterCard(t, onClick = { onItemClick(t) }, width = cardWidth)
            }
        }
    }
}

/**
 * Menu lateral fixo — navegação principal da TV, com a logo real do site.
 *
 * Lista TODAS as abas do site: Início, Filmes, Séries, Categorias, Buscar,
 * Favoritos, Histórico, Planos, Conta, Perfis e Configurações.
 *
 * São 11 itens. Em 1080p o menu tem 1080dp de altura e o cabeçalho (logo +
 * subtítulo) consome ~82dp. Com o padding antigo (7dp) cada item ocupava
 * ~42dp e o 11º item encostava na borda inferior. Reduzido para 5dp de
 * padding e 12sp de fonte: cada item fica em ~36dp, 11 × 36 = 396dp, com
 * folga de sobra mesmo em 720p.
 */
@Composable
fun TvSidebar(
    current: String,
    onSelect: (String) -> Unit,
    email: String?,
    isAdmin: Boolean = false,
) {
    val items = buildList {
        add("home" to "Início")
        add("movies" to "Filmes")
        add("series" to "Séries")
        add("genres" to "Categorias")
        add("search" to "Buscar")
        add("favorites" to "Favoritos")
        add("history" to "Histórico")
        add("plans" to "Planos")
        add("account" to "Conta")
        add("profiles" to "Perfis")
        add("settings" to "Configurações")
        // Só para administrador. `isAdmin` vem do servidor (profiles.is_admin),
        // nunca de um campo que o usuário edite no próprio perfil.
        if (isAdmin) add("admin" to "Painel Admin")
    }

    Column(
        modifier = Modifier
            .width(232.dp)
            .fillMaxHeight()
            .background(MfColors.BgElev)
            .padding(vertical = 18.dp),
    ) {
        Box(Modifier.padding(start = 22.dp)) {
            MfLogo(fontSize = 26, iconSize = 34)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "FILMES E SÉRIES",
            color = MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 9.sp,
            letterSpacing = 1.6.sp,
            modifier = Modifier.padding(start = 22.dp, bottom = 14.dp),
        )

        items.forEach { (key, label) ->
            var focused by remember { mutableStateOf(false) }
            val active = current == key
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 2.dp)
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
                    .padding(horizontal = 14.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Barrinha de ativo, como o .nav-link.active do site.
                Box(
                    Modifier
                        .width(3.dp)
                        .height(13.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(
                            if (active || focused) Color.White
                            else Color.Transparent,
                        ),
                )
                Spacer(Modifier.width(11.dp))
                Text(
                    label,
                    color = if (focused || active) Color.White else MfColors.TextMuted,
                    fontFamily = MfSans,
                    fontSize = 12.sp,
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
                fontSize = 10.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 22.dp),
            )
        }
    }
}

/**
 * Banner de destaque grande, cinematográfico — o `.hero` do site.
 *
 * O degradê é o mesmo: escuro à esquerda (onde fica o texto) e transparente à
 * direita, mais um degradê vertical fechando no fundo.
 */
@Composable
fun TvHero(title: Title?, onPlay: () -> Unit, onDetails: () -> Unit = {}) {
    if (title == null) return
    var focused by remember { mutableStateOf(false) }

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
                        0.60f to MfColors.Bg.copy(alpha = 0.35f),
                        1f to MfColors.Bg,
                    ),
                ),
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 48.dp, bottom = 34.dp)
                .width(660.dp),
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
                            .border(1.dp, MfColors.Purple.copy(alpha = 0.4f), RoundedCornerShape(6.dp))
                            .padding(horizontal = 11.dp, vertical = 4.dp),
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            // Título em Bebas Neue, caixa alta — o .hero-title do site.
            Text(
                title.title.uppercase(),
                style = MfHeroTitle.copy(fontSize = 52.sp, lineHeight = 50.sp),
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(12.dp))
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
                Text(title.year, color = MfColors.TextSoft, fontFamily = MfSans, fontSize = 14.sp)
                if (title.quality.isNotBlank()) {
                    Spacer(Modifier.width(14.dp))
                    Text(
                        title.quality,
                        color = MfColors.TextSoft,
                        fontFamily = MfSans,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .border(1.dp, MfColors.BorderStrong, RoundedCornerShape(4.dp))
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
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
                TvGhostButton("Mais informações", onDetails)
            }
        }
    }
}

/** Botão secundário com foco visível — o .btn--ghost do site. */
@Composable
fun TvGhostButton(text: String, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (focused) MfColors.BgHover else Color.White.copy(alpha = 0.12f))
            .then(
                if (focused) Modifier.border(2.dp, Color.White, RoundedCornerShape(8.dp))
                else Modifier,
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 14.dp),
    ) {
        Text(
            text,
            color = Color.White,
            fontFamily = MfSans,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
        )
    }
}

@Composable
fun TvLoading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            MfLogo(fontSize = 40, iconSize = 56)
            Spacer(Modifier.height(20.dp))
            androidx.compose.material3.CircularProgressIndicator(color = MfColors.Red)
        }
    }
}

@Composable
fun TvError(message: String, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            MfLogo(fontSize = 40, iconSize = 56)
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
fun TvEmpty(text: String, icon: String = "🎬") {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(icon, fontSize = 44.sp)
            Spacer(Modifier.height(14.dp))
            Text(text, color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 16.sp)
        }
    }
}

/** Título de página das telas de TV. */
@Composable
fun TvPageTitle(text: String) {
    Text(
        text,
        color = MfColors.Text,
        fontFamily = MfSans,
        fontSize = 28.sp,
        fontWeight = FontWeight.Black,
        modifier = Modifier.padding(start = 48.dp, top = 28.dp, bottom = 16.dp),
    )
}
