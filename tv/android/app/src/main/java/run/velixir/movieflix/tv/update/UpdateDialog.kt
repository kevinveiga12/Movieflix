package run.velixir.movieflix.tv.update

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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import run.velixir.movieflix.tv.BuildConfig
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfSans

/**
 * Janela de atualização disponível.
 *
 * Aparece por cima do app quando o manifesto anuncia uma versão mais nova.
 * Segue a identidade visual do MovieFlix (fundo escuro, vermelho de destaque) e
 * é navegável inteiramente pelo controle remoto: os dois botões são focáveis e
 * o OK/Enter aciona o que estiver em foco.
 *
 * Estados internos:
 *   • idle      → mostra versão instalada, nova versão e novidades
 *   • downloading → barra de progresso + porcentagem
 *   • error     → mensagem + "TENTAR NOVAMENTE"
 *
 * Quando `mandatory` é verdadeiro, o botão "DEPOIS" não aparece. Não tentamos
 * contornar o Android: apenas não oferecemos o adiamento.
 */
@Composable
fun UpdateDialog(
    manifest: UpdateManager.Manifest,
    installedVersion: String,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    /*
      O Context do Compose pode ser um ContextWrapper, não a Activity. Subir a
      árvore é obrigatório aqui: `startActivity` do instalador e a checagem de
      "instalar apps desconhecidos" precisam da Activity real.
    */
    val activity = remember(context) {
        var c: android.content.Context? = context
        while (c is android.content.ContextWrapper && c !is android.app.Activity) {
            c = c.baseContext
        }
        c as? android.app.Activity
    }

    var downloading by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var permissionNeeded by remember { mutableStateOf(false) }

    val updateFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { updateFocus.requestFocus() } }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xE6000000)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .width(720.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(MfColors.BgCard)
                .border(1.dp, MfColors.Border, RoundedCornerShape(18.dp))
                .padding(36.dp),
        ) {
            Text(
                "ATUALIZAÇÃO DISPONÍVEL!",
                color = MfColors.Red,
                fontFamily = MfSans,
                fontSize = 26.sp,
                fontWeight = FontWeight.ExtraBold,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "Uma nova versão do MovieFlix TV está disponível.",
                color = MfColors.Text,
                fontFamily = MfSans,
                fontSize = 16.sp,
            )
            Spacer(Modifier.height(18.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                VersionBadge("Instalada", installedVersion)
                VersionBadge("Nova versão", manifest.version)
            }

            if (manifest.notes.isNotEmpty()) {
                Spacer(Modifier.height(22.dp))
                Text(
                    "Novidades",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(8.dp))
                manifest.notes.forEach { note ->
                    Text(
                        "•  $note",
                        color = MfColors.TextSoft,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(vertical = 2.dp),
                    )
                }
            }

            Spacer(Modifier.height(24.dp))

            when {
                downloading -> {
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
                }

                error != null -> {
                    Text(
                        error!!,
                        color = MfColors.Red,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        UpdateButton("TENTAR NOVAMENTE", primary = true) {
                            error = null
                            downloading = true
                            progress = 0
                            scope.launch {
                                try {
                                    val apk = UpdateManager.download(context, manifest) { p -> progress = p }
                                    downloading = false
                                    val opened = activity?.let { UpdateManager.install(it, apk) } ?: false
                                    if (!opened) permissionNeeded = true
                                } catch (e: Exception) {
                                    downloading = false
                                    error = e.message ?: "Falha ao baixar a atualização."
                                }
                            }
                        }
                        if (!manifest.mandatory) {
                            UpdateButton("DEPOIS", primary = false, onClick = onDismiss)
                        }
                    }
                }

                permissionNeeded -> {
                    Text(
                        "Permita a instalação de apps desta fonte e toque em ATUALIZAR AGORA novamente.",
                        color = MfColors.TextSoft,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        UpdateButton("ATUALIZAR AGORA", primary = true) {
                            permissionNeeded = false
                            downloading = true
                            progress = 0
                            scope.launch {
                                try {
                                    val apk = UpdateManager.download(context, manifest) { p -> progress = p }
                                    downloading = false
                                    val opened = activity?.let { UpdateManager.install(it, apk) } ?: false
                                    if (!opened) permissionNeeded = true
                                } catch (e: Exception) {
                                    downloading = false
                                    error = e.message ?: "Falha ao baixar a atualização."
                                }
                            }
                        }
                        if (!manifest.mandatory) {
                            UpdateButton("DEPOIS", primary = false, onClick = onDismiss)
                        }
                    }
                }

                else -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        UpdateButton(
                            "ATUALIZAR AGORA",
                            primary = true,
                            modifier = Modifier.focusRequester(updateFocus),
                        ) {
                            downloading = true
                            progress = 0
                            scope.launch {
                                try {
                                    val apk = UpdateManager.download(context, manifest) { p -> progress = p }
                                    downloading = false
                                    val opened = activity?.let { UpdateManager.install(it, apk) } ?: false
                                    if (!opened) permissionNeeded = true
                                } catch (e: Exception) {
                                    downloading = false
                                    error = e.message ?: "Falha ao baixar a atualização."
                                }
                            }
                        }
                        if (!manifest.mandatory) {
                            UpdateButton("DEPOIS", primary = false, onClick = onDismiss)
                        }
                    }
                }
            }
        }
    }
}

/** Rótulo + valor de versão (instalada / nova). */
@Composable
private fun VersionBadge(label: String, value: String) {
    Column {
        Text(
            label,
            color = MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 12.sp,
        )
        Text(
            value,
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

/** Botão focável — o D-pad precisa enxergar o foco para o OK funcionar. */
@Composable
private fun UpdateButton(
    label: String,
    primary: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    focused -> MfColors.Red
                    primary -> MfColors.Red.copy(alpha = 0.85f)
                    else -> MfColors.BgHover
                },
            )
            .border(
                1.dp,
                if (focused) Color.White else Color.Transparent,
                RoundedCornerShape(10.dp),
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(onClick = onClick)
            .padding(horizontal = 26.dp, vertical = 14.dp),
    ) {
        Text(
            label,
            color = Color.White,
            fontFamily = MfSans,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
    }
}
