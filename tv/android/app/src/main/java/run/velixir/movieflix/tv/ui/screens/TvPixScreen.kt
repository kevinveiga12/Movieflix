package run.velixir.movieflix.tv.ui.screens

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import run.velixir.movieflix.tv.TvViewModel
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfSans

/**
 * Pagamento por Pix na TV.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE O QR É GRANDE
 * ═══════════════════════════════════════════════════════════════════════════
 * O controle remoto não digita e a TV não tem câmera. O caminho real é: o
 * cliente aponta o celular para a tela, paga no app do banco, e a TV libera
 * sozinha. Por isso o QR ocupa o centro da tela e o código copia e cola fica
 * visível em fonte legível — para quem preferir digitar no celular.
 *
 * Não é exigido nenhum app MovieFlix no celular: qualquer banco com Pix serve.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA TELA NÃO FAZ
 * ═══════════════════════════════════════════════════════════════════════════
 * Não libera acesso. Quem ativa é o servidor, depois de consultar a API
 * oficial do Mercado Pago. A TV só reflete o que ele respondeu — e, ao
 * aprovar, recarrega a assinatura para o acesso valer sem reinstalar.
 */
@Composable
fun TvPixScreen(vm: TvViewModel, onBack: () -> Unit) {
    val s by vm.state.collectAsState()
    val charge = s.pixCharge
    val approved = charge?.approved == true

    // Polling: consulta o status a cada 4 s enquanto não aprovado.
    LaunchedEffect(charge?.paymentId, approved) {
        if (charge?.paymentId.isNullOrBlank() || approved) return@LaunchedEffect
        while (true) {
            delay(4000)
            vm.refreshPixStatus()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 48.dp, vertical = 28.dp),
    ) {
        TvPageTitle("Pagamento por Pix")
        Spacer(Modifier.height(12.dp))

        if (s.pixLoading) {
            Text(
                "Gerando seu Pix…",
                color = MfColors.TextMuted,
                fontFamily = MfSans,
                fontSize = 16.sp,
            )
        }

        if (s.pixError != null) {
            Text(
                s.pixError ?: "",
                color = MfColors.Text,
                fontFamily = MfSans,
                fontSize = 16.sp,
            )
            Spacer(Modifier.height(16.dp))
            TvPixButton("Voltar aos planos", enabled = true) {
                vm.clearPix()
                onBack()
            }
        }

        // ── Aprovado ──────────────────────────────────────────────────────
        if (approved) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(MfColors.BgCard)
                    .border(1.dp, MfColors.Border, RoundedCornerShape(16.dp))
                    .padding(40.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("✓", color = MfColors.Red, fontSize = 56.sp, fontWeight = FontWeight.Black)
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Pagamento confirmado!",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 26.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Sua assinatura MovieFlix foi ativada. Aproveite seus filmes e séries!",
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 16.sp,
                    )
                    Spacer(Modifier.height(24.dp))
                    TvPixButton("Começar a assistir", enabled = true) {
                        vm.clearPix()
                        onBack()
                    }
                }
            }
        }

        // ── Pendente ──────────────────────────────────────────────────────
        if (charge != null && !approved) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(40.dp),
            ) {
                // QR grande — o cliente aponta o celular para a tela.
                val bmp = remember(charge.qrCodeBase64) {
                    charge.qrCodeBase64?.let { b64 ->
                        runCatching {
                            val bytes = Base64.decode(b64, Base64.DEFAULT)
                            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        }.getOrNull()
                    }
                }
                Box(
                    modifier = Modifier
                        .size(360.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color.White)
                        .padding(16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (bmp != null) {
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = "QR Code Pix",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else {
                        Text(
                            "Gerando QR…",
                            color = Color.Black,
                            fontFamily = MfSans,
                            fontSize = 14.sp,
                        )
                    }
                }

                // Informações e código copia e cola.
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "${charge.plan.name} · ${charge.period.label}",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        charge.amountLabel,
                        color = MfColors.Red,
                        fontFamily = MfSans,
                        fontSize = 30.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Aponte a câmera do celular para o QR Code e pague no app do seu banco. " +
                            "A liberação é automática assim que o pagamento for confirmado.",
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(18.dp))

                    Text(
                        "Pix copia e cola",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(6.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(MfColors.BgHover)
                            .padding(12.dp),
                    ) {
                        Text(
                            charge.qrCode ?: "",
                            color = MfColors.TextMuted,
                            fontFamily = MfSans,
                            fontSize = 10.sp,
                            maxLines = 5,
                        )
                    }
                    Spacer(Modifier.height(16.dp))

                    Text(
                        "Status: " + when (charge.status) {
                            "pending" -> "Aguardando pagamento"
                            "expired" -> "Expirado"
                            "rejected" -> "Recusado"
                            "cancelled" -> "Cancelado"
                            else -> charge.status
                        },
                        color = MfColors.TextDim,
                        fontFamily = MfSans,
                        fontSize = 13.sp,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Esta tela atualiza sozinha.",
                        color = MfColors.TextDim,
                        fontFamily = MfSans,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(20.dp))

                    TvPixButton("Voltar aos planos", enabled = true) {
                        vm.clearPix()
                        onBack()
                    }
                }
            }
        }
    }
}

/**
 * Botão com foco visível para o controle remoto.
 *
 * O anel branco de 3 dp é o mesmo padrão das outras telas da TV — sem ele o
 * cliente não sabe onde está o foco no D-pad.
 */
@Composable
private fun TvPixButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Box(
        modifier = Modifier
            .width(280.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    !enabled -> MfColors.BgHover
                    focused -> MfColors.RedBright
                    else -> MfColors.Red
                },
            )
            .then(
                if (focused) Modifier.border(3.dp, Color.White, RoundedCornerShape(10.dp))
                else Modifier,
            )
            .onFocusChanged { focused = it.isFocused }
            .clickable(enabled = enabled) { onClick() }
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (enabled) Color.White else MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}
