package run.velixir.movieflix.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import run.velixir.movieflix.tv.TvViewModel
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfSans

/**
 * Painel administrativo da TV.
 *
 * Só aparece no menu lateral quando `isAdmin` é verdadeiro — valor que vem do
 * servidor (`profiles.is_admin`, conferido com a Service Role no login) e é
 * revalidado a cada requisição por `requireAdmin`. Não existe campo de perfil
 * que o usuário possa editar para virar administrador.
 */
@Composable
fun TvAdminScreen(vm: TvViewModel) {
    val s by vm.state.collectAsState()

    LaunchedEffect(Unit) { vm.loadAdminStats() }

    Column(Modifier.fillMaxSize()) {
        TvPageTitle("Painel Admin")
        Text(
            "Visível apenas para administradores.",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 14.sp,
            modifier = Modifier.padding(start = 48.dp, bottom = 20.dp),
        )

        if (!s.isAdmin) {
            Box(
                modifier = Modifier
                    .padding(horizontal = 48.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(MfColors.BgCard)
                    .border(1.dp, MfColors.Border, RoundedCornerShape(14.dp))
                    .padding(24.dp),
            ) {
                Text(
                    "Esta conta não tem permissão de administrador.",
                    color = MfColors.TextSoft,
                    fontFamily = MfSans,
                    fontSize = 16.sp,
                )
            }
            return@Column
        }

        val st = s.adminStats

        if (st == null) {
            Text(
                s.adminError ?: "Carregando…",
                color = if (s.adminError != null) MfColors.Warning else MfColors.TextDim,
                fontFamily = MfSans,
                fontSize = 16.sp,
                modifier = Modifier.padding(start = 48.dp),
            )
            return@Column
        }

        Row(
            modifier = Modifier.padding(horizontal = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            TvAdminStat("Usuários", st.users.toString())
            TvAdminStat("Favoritos", st.favorites.toString())
            TvAdminStat("Histórico", st.history.toString())
        }
        Spacer(Modifier.height(16.dp))
        Row(
            modifier = Modifier.padding(horizontal = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            TvAdminStat("Filmes editados", st.editedMovies.toString())
            TvAdminStat("Séries editadas", st.editedSeries.toString())
            TvAdminStat("Títulos ocultos", st.hidden.toString())
        }

        if (!st.updatedAt.isNullOrBlank()) {
            Spacer(Modifier.height(20.dp))
            Text(
                "Última edição: ${st.updatedAt}",
                color = MfColors.TextDim,
                fontFamily = MfSans,
                fontSize = 13.sp,
                modifier = Modifier.padding(start = 48.dp),
            )
        }

        Spacer(Modifier.height(24.dp))
        Text(
            "A edição de catálogo, planos e códigos de teste continua no painel do site, em /admin.",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 14.sp,
            modifier = Modifier.padding(start = 48.dp),
        )
    }
}

@Composable
private fun TvAdminStat(label: String, value: String) {
    Column(
        modifier = Modifier
            .width(240.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(MfColors.BgCard)
            .border(1.dp, MfColors.Border, RoundedCornerShape(14.dp))
            .padding(20.dp),
    ) {
        Text(
            label,
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            value,
            color = MfColors.Red,
            fontFamily = MfSans,
            fontSize = 30.sp,
            fontWeight = FontWeight.Black,
        )
    }
}
