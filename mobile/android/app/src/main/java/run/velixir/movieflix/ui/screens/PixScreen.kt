package run.velixir.movieflix.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import run.velixir.movieflix.AppViewModel
import run.velixir.movieflix.ui.MfLogo
import run.velixir.movieflix.ui.theme.MfColors
import run.velixir.movieflix.ui.theme.MfSans

/**
 * Pagamento por Pix — a tela /pagamento/pix do site.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA TELA FAZ
 * ═══════════════════════════════════════════════════════════════════════════
 * Mostra o QR Code e o código copia e cola que o SERVIDOR obteve do Mercado
 * Pago, e consulta o status em intervalos até aprovar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ELA NÃO FAZ
 * ═══════════════════════════════════════════════════════════════════════════
 * Ela não libera acesso. Não existe botão "já paguei" que ative nada. Quem
 * ativa é o servidor, depois de consultar a API oficial do Mercado Pago e ver
 * `status: approved`. O app só reflete o que o servidor respondeu.
 *
 * O QR é desenhado a partir do PNG em base64 que o Mercado Pago devolveu —
 * nunca é gerado no aparelho, então não há como divergir do código real.
 */
@Composable
fun PixScreen(vm: AppViewModel, onBack: () -> Unit) {
    val s by vm.state.collectAsState()
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }

    val charge = s.pixCharge
    val approved = charge?.approved == true

    // Polling: enquanto não aprovado, consulta o status a cada 4 s.
    // Para sozinho quando aprova — não há motivo para continuar batendo.
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
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        MfLogo(fontSize = 22, iconSize = 28)
        Spacer(Modifier.height(16.dp))

        Text(
            "Pagamento por Pix",
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 24.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(6.dp))

        // ── Carregando ────────────────────────────────────────────────────
        if (s.pixLoading) {
            Text(
                "Gerando seu Pix…",
                color = MfColors.TextMuted,
                fontFamily = MfSans,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(16.dp))
        }

        // ── Erro ──────────────────────────────────────────────────────────
        if (s.pixError != null) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MfColors.BgCard)
                    .border(1.dp, MfColors.Border, RoundedCornerShape(12.dp))
                    .padding(16.dp),
            ) {
                Column {
                    Text(
                        s.pixError ?: "",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 13.sp,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Voltar aos planos",
                        color = MfColors.Red,
                        fontFamily = MfSans,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable { onBack() },
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        // ── Aprovado ──────────────────────────────────────────────────────
        if (approved) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(MfColors.BgCard)
                    .border(1.dp, MfColors.Border, RoundedCornerShape(14.dp))
                    .padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("✓", color = MfColors.Red, fontSize = 40.sp, fontWeight = FontWeight.Black)
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Pagamento confirmado!",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 19.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Sua assinatura MovieFlix foi ativada. Aproveite seus filmes e séries!",
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 13.sp,
                    )
                    Spacer(Modifier.height(18.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(MfColors.Red)
                            .clickable { onBack() }
                            .padding(vertical = 13.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Começar a assistir",
                            color = Color.White,
                            fontFamily = MfSans,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }

        // ── Cobrança pendente ─────────────────────────────────────────────
        if (charge != null && !approved) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(MfColors.BgCard)
                    .border(1.dp, MfColors.Border, RoundedCornerShape(14.dp))
                    .padding(16.dp),
            ) {
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            "${charge.plan.name} · ${charge.period.label}",
                            color = MfColors.Text,
                            fontFamily = MfSans,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            charge.amountLabel,
                            color = MfColors.Red,
                            fontFamily = MfSans,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Black,
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Escaneie o QR Code com o app do seu banco, ou copie o código abaixo. " +
                            "A liberação é automática assim que o pagamento for confirmado.",
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(16.dp))

                    // QR: decodifica o PNG em base64 que o Mercado Pago devolveu.
                    val bmp = remember(charge.qrCodeBase64) {
                        charge.qrCodeBase64?.let { b64 ->
                            runCatching {
                                val bytes = Base64.decode(b64, Base64.DEFAULT)
                                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                            }.getOrNull()
                        }
                    }
                    if (bmp != null) {
                        Box(
                            modifier = Modifier.fillMaxWidth(),
                            contentAlignment = Alignment.Center,
                        ) {
                            Image(
                                bitmap = bmp.asImageBitmap(),
                                contentDescription = "QR Code Pix",
                                contentScale = ContentScale.Fit,
                                modifier = Modifier
                                    .size(240.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(Color.White)
                                    .padding(8.dp),
                            )
                        }
                        Spacer(Modifier.height(16.dp))
                    }

                    Text(
                        "Pix copia e cola",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(6.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(MfColors.BgHover)
                            .padding(10.dp),
                    ) {
                        Text(
                            charge.qrCode ?: "",
                            color = MfColors.TextMuted,
                            fontFamily = MfSans,
                            fontSize = 9.sp,
                            maxLines = 4,
                        )
                    }
                    Spacer(Modifier.height(10.dp))

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(MfColors.Red)
                            .clickable {
                                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE)
                                    as ClipboardManager
                                cm.setPrimaryClip(
                                    ClipData.newPlainText("Pix MovieFlix", charge.qrCode ?: ""),
                                )
                                copied = true
                            }
                            .padding(vertical = 13.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (copied) "✓ Código copiado" else "Copiar código Pix",
                            color = Color.White,
                            fontFamily = MfSans,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }

                    Spacer(Modifier.height(14.dp))
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
                        fontSize = 11.sp,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "A tela atualiza sozinha. Você pode fechar e voltar depois — o pagamento continua valendo.",
                        color = MfColors.TextDim,
                        fontFamily = MfSans,
                        fontSize = 10.sp,
                    )
                }
            }
        }

        Spacer(Modifier.height(20.dp))
        Text(
            "Voltar aos planos",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 13.sp,
            modifier = Modifier.clickable {
                vm.clearPix()
                onBack()
            },
        )
    }
}
