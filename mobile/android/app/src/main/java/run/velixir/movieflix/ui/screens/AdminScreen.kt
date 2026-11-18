package run.velixir.movieflix.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import run.velixir.movieflix.AppViewModel
import run.velixir.movieflix.ui.theme.MfColors
import run.velixir.movieflix.ui.theme.MfSans

/**
 * Painel administrativo do app mobile.
 *
 * Quem pode ver: apenas a conta cujo `profiles.is_admin` é verdadeiro no
 * Supabase. O valor chega pelo login (`/api/auth/login` devolve `isAdmin`
 * depois de conferir o perfil com a Service Role) e é revalidado a cada
 * requisição por `requireAdmin` no servidor — o app nunca decide sozinho e
 * não há campo de perfil que o usuário possa editar para virar admin.
 *
 * Se a conta perder o privilégio, `/api/admin/stats` responde 403 e a tela
 * mostra a mensagem em vez de números inventados.
 */
@Composable
fun AdminScreen(vm: AppViewModel, onBack: () -> Unit) {
    val s by vm.state.collectAsState()

    LaunchedEffect(Unit) { vm.loadAdminStats() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "‹",
                color = MfColors.Text,
                fontSize = 26.sp,
                modifier = Modifier
                    .clickable(onClick = onBack)
                    .padding(end = 12.dp),
            )
            Text(
                "Painel Admin",
                color = MfColors.Text,
                fontFamily = MfSans,
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            "Visível apenas para administradores.",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 12.sp,
        )
        Spacer(Modifier.height(18.dp))

        // Sem privilégio: o servidor recusou. Não mostramos números.
        if (!s.isAdmin) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(MfColors.BgCard)
                    .border(1.dp, MfColors.Border, RoundedCornerShape(14.dp))
                    .padding(20.dp),
            ) {
                Text(
                    "Esta conta não tem permissão de administrador.",
                    color = MfColors.TextSoft,
                    fontFamily = MfSans,
                    fontSize = 13.sp,
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
                fontSize = 13.sp,
            )
        } else {
            // Cartões de número — o mesmo resumo do painel do site.
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                AdminStatCard("Usuários", st.users.toString())
                AdminStatCard("Favoritos", st.favorites.toString())
                AdminStatCard("Histórico", st.history.toString())
                AdminStatCard("Filmes editados", st.editedMovies.toString())
                AdminStatCard("Séries editadas", st.editedSeries.toString())
                AdminStatCard("Títulos ocultos", st.hidden.toString())
            }

            if (!st.updatedAt.isNullOrBlank()) {
                Spacer(Modifier.height(14.dp))
                Text(
                    "Última edição: ${st.updatedAt}",
                    color = MfColors.TextDim,
                    fontFamily = MfSans,
                    fontSize = 11.sp,
                )
            }

            Spacer(Modifier.height(18.dp))
            Text(
                "A edição de catálogo, planos e códigos de teste continua no painel do site, em /admin.",
                color = MfColors.TextMuted,
                fontFamily = MfSans,
                fontSize = 12.sp,
            )
        }

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun AdminStatCard(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MfColors.BgCard)
            .border(1.dp, MfColors.Border, RoundedCornerShape(12.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 13.sp,
        )
        Spacer(Modifier.weight(1f))
        Text(
            value,
            color = MfColors.Red,
            fontFamily = MfSans,
            fontSize = 18.sp,
            fontWeight = FontWeight.Black,
        )
    }
}
