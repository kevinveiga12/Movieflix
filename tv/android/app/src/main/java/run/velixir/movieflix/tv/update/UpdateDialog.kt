package run.velixir.movieflix.tv.update

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
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
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import run.velixir.movieflix.tv.BuildConfig
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfSans

/**
 * Janela de atualização disponível.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA JANELA É UM `Dialog` E NÃO UM `Box` SOBREPOSTO
 * ══════════════════════════════════════════════════════════════════════════════
 * A versão anterior desenhava um `Box(fillMaxSize)` por cima da tela, dentro da
 * MESMA composição do app. Isso causava exatamente os três sintomas relatados:
 *
 *   1. O FOCO FICAVA NO CONTEÚDO DE BAIXO. Um `Box` sobreposto não cria uma
 *      janela de foco própria: o D-pad continuava navegando nos cards e no menu
 *      lateral que estavam atrás do véu escuro. O botão "ATUALIZAR AGORA" nunca
 *      recebia foco, então o OK não fazia nada.
 *
 *   2. O `requestFocus()` ERA PERDIDO. Ele era chamado num `LaunchedEffect(Unit)`
 *      que roda no primeiro frame, antes de o nó de foco existir na árvore. O
 *      `runCatching` engolia a exceção e a janela ficava sem foco nenhum.
 *
 *   3. O BOTÃO NÃO ERA FOCÁVEL. `Modifier.clickable` sozinho responde a toque,
 *      mas não entra na ordem de foco do D-pad. Faltava `focusable()`.
 *
 * Agora a janela é um `Dialog` de verdade: o Android/Compose abre uma janela
 * separada, o foco do app de baixo é suspenso, e o Back não fecha por acidente
 * (`dismissOnBackPress = false`). O foco inicial é pedido DEPOIS de dois frames,
 * quando o nó já existe, e cada botão tem `focusable()` explícito.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O QUE A JANELA NÃO FAZ
 * ══════════════════════════════════════════════════════════════════════════════
 * Não instala nada sozinha. Ela baixa o APK, valida o SHA-256 e abre o
 * instalador do Android — que SEMPRE pede confirmação do usuário. Instalação
 * silenciosa exigiria root e não é prometida em lugar nenhum.
 *
 * Instalar por cima (mesmo applicationId + mesma assinatura) preserva login,
 * sessão e dados locais: o app não limpa armazenamento em nenhum momento.
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
      árvore é obrigatório: `startActivity` do instalador e a checagem de
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

    /*
      Foco inicial.

      `requestFocus()` só funciona quando o nó já está na árvore. Dois frames
      depois da composição é o ponto seguro: o Dialog já foi anexado à janela e
      o botão já existe. Se falhar (raro), não derrubamos nada — o usuário ainda
      consegue chegar ao botão com o D-pad, porque agora ele é focável.
    */
    val primaryFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        withFrameNanos { }
        runCatching { primaryFocus.requestFocus() }
    }

    /** Baixa, valida o hash e abre o instalador. */
    fun startDownload() {
        downloading = true
        progress = 0
        error = null
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

    Dialog(
        onDismissRequest = {
            /*
              Back / clique fora NÃO fecham a janela por conta própria. Quando a
              atualização é opcional, o fechamento é uma decisão explícita do
              usuário no botão "DEPOIS" — nunca um toque acidental no controle.
            */
            if (!manifest.mandatory && !downloading) onDismiss()
        },
        properties = DialogProperties(
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
            usePlatformDefaultWidth = false,
        ),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color(0xE6000000))
                /*
                  Back explícito: com `dismissOnBackPress = false` o Dialog não
                  fecha sozinho, então tratamos a tecla aqui. Durante o download
                  o Back é ignorado — fechar no meio deixaria um APK parcial.
                */
                .onKeyEvent { ev ->
                    if (ev.type != KeyEventType.KeyDown || ev.key != Key.Back) return@onKeyEvent false
                    if (downloading) return@onKeyEvent true
                    if (!manifest.mandatory) {
                        onDismiss()
                        true
                    } else {
                        // Atualização obrigatória: Back não escapa da janela.
                        true
                    }
                },
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
                    "Deseja atualizar agora?",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Uma nova versão do MovieFlix TV está disponível. Seus dados e seu login são mantidos.",
                    color = MfColors.TextSoft,
                    fontFamily = MfSans,
                    fontSize = 15.sp,
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
                    manifest.notes.take(6).forEach { note ->
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
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "Não desligue a TV. O instalador do Android abre em seguida.",
                            color = MfColors.TextDim,
                            fontFamily = MfSans,
                            fontSize = 13.sp,
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
                            UpdateButton(
                                "TENTAR NOVAMENTE",
                                primary = true,
                                modifier = Modifier.focusRequester(primaryFocus),
                                onClick = { startDownload() },
                            )
                            if (!manifest.mandatory) {
                                UpdateButton("DEPOIS", primary = false, onClick = onDismiss)
                            }
                        }
                    }

                    permissionNeeded -> {
                        Text(
                            "Permita a instalação de apps desta fonte e escolha ATUALIZAR AGORA novamente.",
                            color = MfColors.TextSoft,
                            fontFamily = MfSans,
                            fontSize = 14.sp,
                        )
                        Spacer(Modifier.height(16.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            UpdateButton(
                                "ATUALIZAR AGORA",
                                primary = true,
                                modifier = Modifier.focusRequester(primaryFocus),
                                onClick = {
                                    permissionNeeded = false
                                    startDownload()
                                },
                            )
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
                                modifier = Modifier.focusRequester(primaryFocus),
                                onClick = { startDownload() },
                            )
                            if (!manifest.mandatory) {
                                UpdateButton("DEPOIS", primary = false, onClick = onDismiss)
                            }
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

/**
 * Botão focável.
 *
 * `focusable()` é o que coloca o botão na ordem de foco do D-pad — sem ele,
 * `clickable` só responde a toque e o controle remoto nunca chega aqui. O
 * `onFocusChanged` pinta a borda branca para o foco ficar visível a 3 metros.
 */
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
                    focused -> MfColors.RedBright
                    primary -> MfColors.Red
                    else -> MfColors.BgHover
                },
            )
            .border(
                if (focused) 3.dp else 1.dp,
                if (focused) Color.White else Color.Transparent,
                RoundedCornerShape(10.dp),
            )
            .onFocusChanged { focused = it.isFocused }
            .focusable()
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
