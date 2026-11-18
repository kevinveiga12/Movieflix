package run.velixir.movieflix.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import run.velixir.movieflix.R

/**
 * Paleta e tipografia IDÊNTICAS ao site (src/styles/global.css).
 *
 *   --mf-red        #df0a15      --mf-red-bright #ff2d2d
 *   --mf-red-dark   #b00710      --mf-purple     #8b5cf6
 *   --bg            #0a0a0f      --bg-elev       #121218
 *   --bg-card       #17171f      --bg-hover      #1f1f2a
 *   --text          #ffffff      --text-muted    #9a9aab
 *
 * Tipografia do site: Bebas Neue nos títulos (condensada, caixa alta) e Inter
 * no texto. As duas fontes estão empacotadas em res/font — não dependem de
 * download, então a marca aparece igual mesmo sem internet.
 */
object MfColors {
    val Red = Color(0xFFDF0A15)
    val RedBright = Color(0xFFFF2D2D)
    val RedDark = Color(0xFFB00710)
    val Purple = Color(0xFF8B5CF6)
    val PurpleDeep = Color(0xFF6D28D9)
    val Bg = Color(0xFF0A0A0F)
    val BgElev = Color(0xFF121218)
    val BgCard = Color(0xFF17171F)
    val BgHover = Color(0xFF1F1F2A)
    val Border = Color(0x14FFFFFF)
    val BorderStrong = Color(0x29FFFFFF)
    val Text = Color(0xFFFFFFFF)
    val TextSoft = Color(0xFFD8D8E2)
    val TextMuted = Color(0xFF9A9AAB)
    val TextDim = Color(0xFF6B6B7B)
    val Success = Color(0xFF10B981)
    val Warning = Color(0xFFFBBF24)
    val Danger = Color(0xFFEF4444)
}

/** Bebas Neue — a fonte dos títulos e do logo no site. */
val MfDisplay = FontFamily(Font(R.font.bebas_neue, FontWeight.Normal))

/** Inter — a fonte do corpo de texto no site. */
val MfSans = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
    Font(R.font.inter_extrabold, FontWeight.ExtraBold),
    Font(R.font.inter_black, FontWeight.Black),
)

/** Título de seção do site: Inter 700, com a barrinha vermelha antes. */
val MfSectionTitle = TextStyle(
    fontFamily = MfSans,
    fontWeight = FontWeight.Bold,
    fontSize = 17.sp,
    letterSpacing = 0.sp,
)

/** Título grande de destaque: Bebas Neue, caixa alta, como o .display do site. */
val MfHeroTitle = TextStyle(
    fontFamily = MfDisplay,
    fontWeight = FontWeight.Normal,
    fontSize = 44.sp,
    letterSpacing = 0.9.sp,
    lineHeight = 44.sp,
)

/** Nome da marca no cabeçalho: Bebas Neue com o letter-spacing do .brand-word. */
val MfBrand = TextStyle(
    fontFamily = MfDisplay,
    fontWeight = FontWeight.Normal,
    fontSize = 26.sp,
    letterSpacing = 1.1.sp,
)

private val MfScheme = darkColorScheme(
    primary = MfColors.Red,
    onPrimary = Color.White,
    secondary = MfColors.Purple,
    onSecondary = Color.White,
    background = MfColors.Bg,
    onBackground = MfColors.Text,
    surface = MfColors.BgElev,
    onSurface = MfColors.Text,
    surfaceVariant = MfColors.BgCard,
    onSurfaceVariant = MfColors.TextMuted,
    error = MfColors.Danger,
)

@Composable
fun MovieFlixTheme(content: @Composable () -> Unit) {
    // A marca é escura sempre — o tema do sistema é ignorado de propósito.
    MaterialTheme(colorScheme = MfScheme, content = content)
}
