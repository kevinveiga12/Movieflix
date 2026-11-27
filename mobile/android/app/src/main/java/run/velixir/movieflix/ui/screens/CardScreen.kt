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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import run.velixir.movieflix.AppViewModel
import run.velixir.movieflix.ui.theme.MfColors
import run.velixir.movieflix.ui.theme.MfSans

/**
 * Pagamento com cartão de crédito ou débito (celular).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O DADO DO CARTÃO NÃO SAI DESTA TELA PARA O NOSSO SERVIDOR
 * ══════════════════════════════════════════════════════════════════════════════
 * Os campos são `remember` local: quando a tela fecha, o texto morre. Ao
 * confirmar, `vm.payWithCard` tokeniza direto no Mercado Pago e só o token
 * segue para o backend.
 *
 * Nada é gravado em SharedPreferences, arquivo ou log.
 */
@Composable
fun CardScreen(
    vm: AppViewModel,
    planCode: String,
    period: String,
    planName: String,
    periodLabel: String,
    amountLabel: String,
    onBack: () -> Unit,
) {
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
            .padding(16.dp),
    ) {
        Text(
            "Pagamento com cartão",
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 22.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            "$planName · $periodLabel · $amountLabel",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(16.dp))

        // ── Aprovado ───────────────────────────────────────────────────────
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
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Pagamento confirmado!",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 19.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Sua assinatura MovieFlix foi ativada. Aproveite seus filmes e séries!",
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 13.sp,
                    )
                    Spacer(Modifier.height(16.dp))
                    MfPrimaryButton("Começar a assistir") {
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
                    .clip(RoundedCornerShape(12.dp))
                    .background(MfColors.BgHover)
                    .border(1.dp, if (pending) MfColors.Border else MfColors.Red, RoundedCornerShape(12.dp))
                    .padding(16.dp),
            ) {
                Column {
                    Text(
                        charge.message ?: "Não foi possível confirmar o pagamento.",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        if (pending) {
                            "A liberação é automática assim que o banco aprovar."
                        } else {
                            "Nenhum valor foi cobrado. Tente outro cartão ou pague com Pix."
                        },
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 12.sp,
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            MfPrimaryButton("Tentar novamente") { vm.clearCard() }
            Spacer(Modifier.height(8.dp))
            MfOutlineButton("Voltar aos planos") {
                vm.clearCard()
                onBack()
            }
            return@Column
        }

        if (s.cardError != null) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(MfColors.BgHover)
                    .border(1.dp, MfColors.Red, RoundedCornerShape(10.dp))
                    .padding(12.dp),
            ) {
                Text(
                    s.cardError ?: "",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 13.sp,
                )
            }
            Spacer(Modifier.height(12.dp))
        }

        // ── Campos ─────────────────────────────────────────────────────────
        MfCardField(
            label = "Número do cartão",
            value = number,
            placeholder = "0000 0000 0000 0000",
            keyboard = KeyboardType.Number,
        ) { v ->
            val d = v.filter { it.isDigit() }.take(19)
            number = d.chunked(4).joinToString(" ")
        }
        Spacer(Modifier.height(10.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.weight(1f)) {
                MfCardField(
                    label = "Validade",
                    value = expiry,
                    placeholder = "MM/AA",
                    keyboard = KeyboardType.Number,
                ) { v ->
                    val d = v.filter { it.isDigit() }.take(4)
                    expiry = if (d.length <= 2) d else "${d.take(2)}/${d.drop(2)}"
                }
            }
            Box(Modifier.width(110.dp)) {
                MfCardField(
                    label = "CVV",
                    value = cvv,
                    placeholder = "123",
                    keyboard = KeyboardType.Number,
                ) { v -> cvv = v.filter { it.isDigit() }.take(4) }
            }
        }
        Spacer(Modifier.height(10.dp))

        MfCardField(
            label = "Nome impresso no cartão",
            value = holder,
            placeholder = "COMO ESTÁ NO CARTÃO",
        ) { v -> holder = v.uppercase().take(40) }

        Spacer(Modifier.height(18.dp))

        val canPay = number.replace(" ", "").length >= 13 &&
            expiry.length == 5 &&
            cvv.length >= 3 &&
            holder.trim().length >= 3 &&
            !s.cardLoading

        MfPrimaryButton(
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
        Spacer(Modifier.height(8.dp))
        MfOutlineButton("Voltar", enabled = !s.cardLoading) {
            vm.clearCard()
            onBack()
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "Os dados vão direto ao Mercado Pago. O MovieFlix não armazena o número do seu cartão.",
            color = MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 11.sp,
        )
    }
}

@Composable
private fun MfPrimaryButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (enabled) MfColors.Red else MfColors.BgHover)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (enabled) Color.White else MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun MfOutlineButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, MfColors.Border, RoundedCornerShape(10.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 13.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (enabled) MfColors.TextSoft else MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun MfCardField(
    label: String,
    value: String,
    placeholder: String,
    keyboard: KeyboardType = KeyboardType.Text,
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label, fontFamily = MfSans, fontSize = 12.sp) },
        placeholder = { Text(placeholder, fontFamily = MfSans, fontSize = 14.sp) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        textStyle = androidx.compose.ui.text.TextStyle(
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
        ),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MfColors.Red,
            unfocusedBorderColor = MfColors.Border,
            focusedLabelColor = MfColors.Red,
            unfocusedLabelColor = MfColors.TextMuted,
            cursorColor = MfColors.Red,
            focusedContainerColor = MfColors.BgHover,
            unfocusedContainerColor = MfColors.BgHover,
        ),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth(),
    )
}
