package run.velixir.movieflix.tv.ui.screens

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import run.velixir.movieflix.tv.BuildConfig
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfSans
import run.velixir.movieflix.tv.update.UpdateManager

/**
 * Página de atualização do MovieFlix TV — uma TELA de verdade.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO SUBSTITUI A JANELA SOBREPOSTA
 * ══════════════════════════════════════════════════════════════════════════════
 * O pedido do cliente foi explícito: "não quero que abra uma página em cima do
 * meu MovieFlix; quero que exista uma página que redirecione para essa página,
 * pra eu poder atualizar". A janela anterior era um overlay por cima do app —
 * e, no aparelho, o controle remoto não conseguia acionar o botão de atualizar.
 *
 * Agora a atualização é uma ROTA do app (`TvRoute.Update`), desenhada no mesmo
 * lugar que Home, Planos e Configurações. Consequências:
 *
 *   · não há sobreposição: o MovieFlix não fica atrás de um véu;
 *   · o foco é o foco normal do Compose, o mesmo que já funciona no resto do
 *     app — o D-pad navega entre os botões sem nenhum tratador global;
 *   · o botão "Atualizar" é um botão comum, com anel de foco visível;
 *   · a página é alcançável a qualquer momento pelo menu lateral ("Atualizar").
 *
 * Ao abrir o app, se houver versão nova, a rota inicial passa a ser esta página
 * (ver MainActivity). Se não houver atualização, a página mostra "você está na
 * versão mais recente" e o botão "Continuar" leva ao catálogo.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O QUE ESTA PÁGINA NÃO FAZ
 * ══════════════════════════════════════════════════════════════════════════════
 * Não instala nada sozinha. Baixa o APK, valida o SHA-256 contra o manifesto e
 * abre o instalador OFICIAL do Android, que sempre pede confirmação. Instalar
 * por cima (mesmo applicationId + mesma assinatura) preserva login e dados.
 */
@Composable
fun TvUpdateScreen(
    manifest: UpdateManager.Manifest?,
    onContinue: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // A Activity real: `startActivity` do instalador e a checagem de "instalar
    // apps desconhecidos" não funcionam com um ContextWrapper.
    val activity = remember(context) {
        var c: Context? = context
        while (c is ContextWrapper && c !is Activity) c = c.baseContext
        c as? Activity
    }

    val installedCode = BuildConfig.VERSION_CODE
    val installedName = BuildConfig.VERSION_NAME
    val hasUpdate = UpdateManager.isNewer(manifest, installedCode)

    var downloading by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var permissionNeeded by remember { mutableStateOf(false) }

    val focusAtualizar = remember { FocusRequester() }
    val focusContinuar = remember { FocusRequester() }

    // Foco inicial no botão principal — é o que o cliente quer acionar.
    // O pequeno atraso garante que o layout já existe quando pedimos o foco;
    // pedir antes da primeira composição faria o pedido ser descartado.
    LaunchedEffect(hasUpdate, manifest) {
        kotlinx.coroutines.delay(150)
        runCatching { if (hasUpdate) focusAtualizar.requestFocus() else focusContinuar.requestFocus() }
    }

    fun startDownload() {
        val m = manifest ?: return
        downloading = true
        progress = 0
        error = null
        scope.launch {
            try {
                val apk = UpdateManager.download(context, m) { p -> progress = p }
                downloading = false
                val act = activity
                if (act == null) {
                    // Sem Activity não há como abrir o instalador do sistema.
                    error = "Não foi possível abrir o instalador. Feche e abra o MovieFlix e tente de novo."
                } else if (!UpdateManager.install(act, apk)) {
                    // O Android abriu a tela de permissão de "instalar apps
                    // desconhecidos"; o cliente autoriza e toca em Atualizar de novo.
                    permissionNeeded = true
                }
            } catch (e: Exception) {
                downloading = false
                error = e.message ?: "Falha ao baixar a atualização."
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 48.dp, vertical = 28.dp),
    ) {
        TvPageTitle("Atualização")
        Spacer(Modifier.height(10.dp))

        Text(
            when {
                manifest == null -> "Verificando se há uma versão nova…"
                hasUpdate -> "Uma nova versão do MovieFlix TV está disponível."
                else -> "Seu MovieFlix TV está atualizado."
            },
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 20.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Atualizar mantém seu login, sua assinatura e seus dados — nada é apagado.",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(22.dp))

        // ── Versões ──────────────────────────────────────────────────────────
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            VersionCard("Instalada", installedName, "código $installedCode")
            VersionCard(
                "Disponível",
                manifest?.version ?: installedName,
                if (hasUpdate) "código ${manifest?.versionCode ?: 0}" else "já é a mais recente",
                destaque = hasUpdate,
            )
        }

        // ── Novidades ────────────────────────────────────────────────────────
        val notes = manifest?.notes.orEmpty()
        if (hasUpdate && notes.isNotEmpty()) {
            Spacer(Modifier.height(24.dp))
            Text(
                "Novidades desta versão",
                color = MfColors.Text,
                fontFamily = MfSans,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MfColors.BgCard)
                    .border(1.dp, MfColors.Border, RoundedCornerShape(12.dp))
                    .padding(20.dp),
            ) {
                Column {
                    notes.forEach { note ->
                        Text(
                            "•  $note",
                            color = MfColors.TextSoft,
                            fontFamily = MfSans,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(vertical = 3.dp),
                        )
                    }
                }
            }
        }

        // ── Progresso ────────────────────────────────────────────────────────
        if (downloading) {
            Spacer(Modifier.height(22.dp))
            Text(
                "Baixando… $progress%",
                color = MfColors.Text,
                fontFamily = MfSans,
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(10.dp))
            LinearProgressIndicator(
                progress = { progress / 100f },
                modifier = Modifier.fillMaxWidth().height(8.dp),
                color = MfColors.Red,
                trackColor = MfColors.BgHover,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "Não desligue a TV. O instalador do Android abre em seguida.",
                color = MfColors.TextDim,
                fontFamily = MfSans,
                fontSize = 13.sp,
            )
        }

        if (permissionNeeded) {
            Spacer(Modifier.height(18.dp))
            Text(
                "Autorize o MovieFlix a instalar aplicativos na tela que abriu e volte aqui para tocar em Atualizar novamente.",
                color = MfColors.TextSoft,
                fontFamily = MfSans,
                fontSize = 14.sp,
            )
        }

        if (error != null) {
            Spacer(Modifier.height(18.dp))
            Text(
                error!!,
                color = MfColors.Red,
                fontFamily = MfSans,
                fontSize = 14.sp,
            )
        }

        // ── Botões ───────────────────────────────────────────────────────────
        Spacer(Modifier.height(26.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            if (hasUpdate) {
                TvPixButton(
                    if (downloading) "Baixando…" else if (error != null) "Tentar novamente" else "Atualizar",
                    enabled = !downloading,
                    focusRequester = focusAtualizar,
                ) { startDownload() }
            }
            TvPixButton(
                if (hasUpdate) "Agora não" else "Continuar",
                enabled = !downloading,
                focusRequester = focusContinuar,
            ) { onContinue() }
        }

        Spacer(Modifier.height(18.dp))
        Text(
            "MovieFlix TV ${BuildConfig.VERSION_NAME} · ${BuildConfig.VERSION_CODE}",
            color = MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 12.sp,
        )
    }
}

/** Cartão de versão: rótulo, número grande e uma linha de detalhe. */
@Composable
private fun VersionCard(label: String, version: String, detail: String, destaque: Boolean = false) {
    Box(
        modifier = Modifier
            .width(260.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MfColors.BgCard)
            .border(
                if (destaque) 2.dp else 1.dp,
                if (destaque) MfColors.Red else MfColors.Border,
                RoundedCornerShape(12.dp),
            )
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Column {
            Text(
                label.uppercase(),
                color = MfColors.TextDim,
                fontFamily = MfSans,
                fontSize = 10.sp,
                letterSpacing = 1.4.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                version,
                color = if (destaque) MfColors.Red else MfColors.Text,
                fontFamily = MfSans,
                fontSize = 26.sp,
                fontWeight = FontWeight.Black,
            )
            Spacer(Modifier.height(2.dp))
            Text(detail, color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 12.sp)
        }
    }
}
