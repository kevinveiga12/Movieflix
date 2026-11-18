package run.velixir.movieflix.tv.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Paleta idêntica ao site (src/styles/global.css):
 *   --mf-red #DF0A15 · --mf-red-bright #FF2D2D · --mf-purple #8B5CF6
 *   --bg #0A0A0F · --bg-elev #121218 · --bg-card #17171F · --text #FFFFFF
 *   --text-muted #9A9AAB
 * O app é sempre escuro — é a identidade do MovieFlix.
 */
object MfColors {
    val Red = Color(0xFFDF0A15)
    val RedBright = Color(0xFFFF2D2D)
    val RedDark = Color(0xFFB00710)
    val Purple = Color(0xFF8B5CF6)
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

/** Títulos usam a mesma linguagem condensada do site (Bebas Neue no web). */
val MfTitleStyle = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = FontWeight.Black,
    fontSize = 26.sp,
    letterSpacing = 0.5.sp,
)

@Composable
fun MovieFlixTheme(content: @Composable () -> Unit) {
    // isSystemInDarkTheme() é ignorado de propósito: a marca é escura sempre.
    @Suppress("UNUSED_EXPRESSION")
    isSystemInDarkTheme()
    MaterialTheme(colorScheme = MfScheme, content = content)
}
