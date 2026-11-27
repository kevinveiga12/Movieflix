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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import run.velixir.movieflix.tv.TvViewModel
import run.velixir.movieflix.tv.ui.theme.MfColors
import run.velixir.movieflix.tv.ui.theme.MfSans

/**
 * Pagamento com cartão de crédito ou débito na TV.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO NÃO É A MESMA TELA DO CELULAR
 * ══════════════════════════════════════════════════════════════════════════════
 * Numa TV o cliente digita com o D-pad, um caractere por vez. Um campo que rola
 * horizontalmente e esconde o que já foi digitado é inutilizável à distância —
 * por isso cada campo mostra o número formatado (grupos de 4) e o foco acende o
 * anel branco, igual às outras telas do app.
 *
 * A ordem dos campos segue o caminho do D-pad para baixo: número → validade →
 * CVV → nome. O botão de pagar é o último, para ninguém cair nele sem querer.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O QUE ESTA TELA NÃO GUARDA
 * ══════════════════════════════════════════════════════════════════════════════
 * Os campos são estado local do Compose (`remember`), não do ViewModel: quando a
 * tela fecha, o texto morre. Só o resultado da cobrança (`cardCharge`) sobe para
 * o ViewModel — e ele não tem número de cartão.
 */
@Composable
fun TvCardScreen(vm: TvViewModel, planCode: String, period: String, planName: String, periodLabel: String, amountLabel: String, onBack: () -> Unit) {
    val s by vm.state.collectAsState()
    val charge = s.cardCharge
    val approved = charge?.approved == true

    var number by remember { mutableStateOf("") }
    var expiry by remember { mutableStateOf("") }
    var cvv by remember { mutableStateOf("") }
    var holder by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 48.dp, vertical = 24.dp),
    ) {
        TvPageTitle("Pagamento com cartão")
        Spacer(Modifier.height(6.dp))

        // ── Aprovado ───────────────────────────────────────────────────────
        if (approved) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(MfColors.BgCard)
                    .border(1.dp, MfColors.Border, RoundedCornerShape(16.dp))
                    .padding(36.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("✓", color = MfColors.Red, fontSize = 52.sp, fontWeight = FontWeight.Black)
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Pagamento confirmado!",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Sua assinatura MovieFlix foi ativada. Aproveite seus filmes e séries!",
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 15.sp,
                    )
                    Spacer(Modifier.height(20.dp))
                    TvPixButton("Começar a assistir", enabled = true) {
                        vm.clearCard()
                        onBack()
                    }
                }
            }
            return@Column
        }

        // ── Recusado / em análise ─────────────────────────────────────────
        if (charge != null && !approved) {
            val pending = charge.status == "in_process" || charge.status == "pending"
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(MfColors.BgHover)
                    .border(1.dp, if (pending) MfColors.Border else MfColors.Red, RoundedCornerShape(14.dp))
                    .padding(24.dp),
            ) {
                Column {
                    Text(
                        charge.message ?: "Não foi possível confirmar o pagamento.",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        if (pending) {
                            "A liberação é automática assim que o banco aprovar. Você pode fechar esta tela."
                        } else {
                            "Nenhum valor foi cobrado. Tente outro cartão ou pague com Pix."
                        },
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 13.sp,
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TvPixButton("Tentar novamente", enabled = true) { vm.clearCard() }
                TvPixButton("Voltar aos planos", enabled = true) {
                    vm.clearCard()
                    onBack()
                }
            }
            return@Column
        }

        // ── Cabeçalho do pedido ────────────────────────────────────────────
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "$planName · $periodLabel",
                color = MfColors.Text,
                fontFamily = MfSans,
                fontSize = 18.sp,
                fontWeight = FontWeight.Black,
            )
            Spacer(Modifier.width(14.dp))
            Text(
                amountLabel,
                color = MfColors.Red,
                fontFamily = MfSans,
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            "Crédito ou débito. Os dados vão direto ao Mercado Pago — o MovieFlix não armazena o número do cartão.",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(18.dp))

        if (s.cardError != null) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(MfColors.BgHover)
                    .border(1.dp, MfColors.Red, RoundedCornerShape(10.dp))
                    .padding(14.dp),
            ) {
                Text(
                    s.cardError ?: "",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 14.sp,
                )
            }
            Spacer(Modifier.height(14.dp))
        }

        // ── Campos ─────────────────────────────────────────────────────────
        TvCardField(
            label = "Número do cartão",
            value = number,
            placeholder = "0000 0000 0000 0000",
            keyboard = KeyboardType.Number,
            width = 520.dp,
            onChange = { v ->
                // Agrupa de 4 em 4 enquanto digita — é o que o cliente espera
                // ver no cartão físico.
                val d = v.filter { it.isDigit() }.take(19)
                number = d.chunked(4).joinToString(" ")
            },
        )
        Spacer(Modifier.height(12.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            TvCardField(
                label = "Validade",
                value = expiry,
                placeholder = "MM/AA",
                keyboard = KeyboardType.Number,
                width = 200.dp,
                onChange = { v ->
                    val d = v.filter { it.isDigit() }.take(4)
                    expiry = if (d.length <= 2) d else "${d.take(2)}/${d.drop(2)}"
                },
            )
            TvCardField(
                label = "CVV",
                value = cvv,
                placeholder = "123",
                keyboard = KeyboardType.Number,
                width = 150.dp,
                onChange = { v -> cvv = v.filter { it.isDigit() }.take(4) },
            )
        }
        Spacer(Modifier.height(12.dp))

        TvCardField(
            label = "Nome impresso no cartão",
            value = holder,
            placeholder = "COMO ESTÁ NO CARTÃO",
            width = 520.dp,
            onChange = { v -> holder = v.uppercase().take(40) },
        )
        Spacer(Modifier.height(20.dp))

        val canPay = number.replace(" ", "").length >= 13 &&
            expiry.length == 5 &&
            cvv.length >= 3 &&
            holder.trim().length >= 3 &&
            !s.cardLoading

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvPixButton(
                if (s.cardLoading) "Processando…" else "Pagar $amountLabel",
                enabled = canPay,
            ) {
                val parts = expiry.split("/")
                vm.payWithCard(
                    planCode = planCode,
                    period = period,
                    number = number,
                    month = parts.getOrNull(0)?.toIntOrNull() ?: 0,
                    year = parts.getOrNull(1)?.let { y ->
                        if (y.length == 2) 2000 + (y.toIntOrNull() ?: 0) else y.toIntOrNull() ?: 0
                    } ?: 0,
                    cvv = cvv,
                    holder = holder.trim(),
                )
            }
            TvPixButton("Voltar", enabled = !s.cardLoading) {
                vm.clearCard()
                onBack()
            }
        }
    }
}

/**
 * Campo de texto com foco visível para o D-pad.
 *
 * `BasicTextField` em vez de `TextField` do Material: o Material pensa em toque
 * (cursor, seleção com dedo) e na TV isso vira ruído visual. Aqui o que importa
 * é: o anel branco diz onde o foco está, e o texto é legível a 3 metros.
 */
@Composable
private fun TvCardField(
    label: String,
    value: String,
    placeholder: String,
    width: androidx.compose.ui.unit.Dp,
    keyboard: KeyboardType = KeyboardType.Text,
    onChange: (String) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }

    Column {
        Text(
            label,
            color = if (focused) MfColors.Text else MfColors.TextSoft,
            fontFamily = MfSans,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(5.dp))
        Box(
            modifier = Modifier
                .width(width)
                .height(48.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(MfColors.BgHover)
                .then(
                    if (focused) Modifier.border(3.dp, Color.White, RoundedCornerShape(8.dp))
                    else Modifier.border(1.dp, MfColors.Border, RoundedCornerShape(8.dp)),
                )
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = TextStyle(
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                ),
                cursorBrush = SolidColor(MfColors.Red),
                keyboardOptions = KeyboardOptions(keyboardType = keyboard),
                modifier = Modifier
                    .fillMaxWidth()
                    .onFocusChanged { focused = it.isFocused }
                    /*
                      Na TV o OK abre o teclado virtual; as setas precisam andar
                      entre campos, não dentro do texto. Sem isto, a seta
                      esquerda/direita moveria o cursor e o cliente ficaria
                      preso no campo.
                    */
                    .onPreviewKeyEvent { ev ->
                        if (ev.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                        when (ev.key) {
                            Key.DirectionDown, Key.DirectionUp -> true
                            Key.DirectionLeft, Key.DirectionRight -> true
                            else -> false
                        }
                    },
                decorationBox = { inner ->
                    Box {
                        if (value.isEmpty()) {
                            Text(
                                placeholder,
                                color = MfColors.TextDim,
                                fontFamily = MfSans,
                                fontSize = 17.sp,
                            )
                        }
                        inner()
                    }
                },
            )
        }
    }
}
