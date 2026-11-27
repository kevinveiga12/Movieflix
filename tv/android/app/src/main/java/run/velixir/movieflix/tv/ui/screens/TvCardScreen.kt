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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
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
 * O BUG QUE ESTA VERSÃO CORRIGE (relatado no aparelho)
 * ══════════════════════════════════════════════════════════════════════════════
 * O cliente conseguia focar o número do cartão e digitar, mas o D-pad não descia
 * para validade, CVV e nome — "clico e não anda". No Pix funcionava.
 *
 * CAUSA: cada campo tinha um `onPreviewKeyEvent` que devolvia `true` para
 * DirectionUp/Down/Left/Right. Devolver `true` significa "eu consumi a tecla":
 * a tecla morria ali e o Compose nunca recebia o pedido de mover o foco. O
 * campo ficava preso para sempre.
 *
 * CORREÇÃO: a navegação não depende mais do comportamento implícito do
 * `BasicTextField` (que também consome setas para mover o cursor). Cada campo
 * tem um `FocusRequester` próprio e uma cadeia explícita de foco:
 *
 *     número → validade → CVV → nome → PAGAR → VOLTAR
 *
 * A seta é tratada aqui, move o foco para o vizinho certo e SÓ ENTÃO devolve
 * `true` (consumida). Assim o foco anda sempre, na ordem certa, e o cursor do
 * texto nunca "rouba" a seta. OK/ENTER abre o teclado na tela do campo em foco.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O QUE ESTA TELA NÃO GUARDA
 * ══════════════════════════════════════════════════════════════════════════════
 * Os campos são estado local do Compose (`remember`), não do ViewModel: quando a
 * tela fecha, o texto morre. Só o resultado da cobrança (`cardCharge`) sobe para
 * o ViewModel — e ele não tem número de cartão.
 */
@Composable
fun TvCardScreen(
    vm: TvViewModel,
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

    /*
      Cadeia de foco. Índices fixos, na ordem em que o cliente preenche:
        0 número · 1 validade · 2 CVV · 3 nome · 4 PAGAR · 5 VOLTAR
      `idx` guarda quem está em foco para as setas saberem para onde ir.
    */
    val focus = remember { List(6) { FocusRequester() } }
    var idx by remember { mutableStateOf(0) }
    val keyboard = LocalSoftwareKeyboardController.current

    fun go(to: Int) {
        val t = to.coerceIn(0, focus.lastIndex)
        idx = t
        // Se o foco sair de um campo de texto, o teclado na tela fecha sozinho.
        if (t > 3) keyboard?.hide()
        runCatching { focus[t].requestFocus() }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 48.dp, vertical = 24.dp),
    ) {
        TvPageTitle("Pagamento com cartão")
        Spacer(Modifier.height(6.dp))

        // ── Aprovado ─────────────────────────────────────────────────────────
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

        // ── Recusado / em análise ────────────────────────────────────────────
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

        // ── Cabeçalho do pedido ──────────────────────────────────────────────
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

        // ── Campos ───────────────────────────────────────────────────────────
        TvCardField(
            label = "Número do cartão",
            value = number,
            placeholder = "0000 0000 0000 0000",
            keyboard = KeyboardType.Number,
            width = 520.dp,
            focusRequester = focus[0],
            onFocused = { idx = 0 },
            onUp = { go(0) },
            onDown = { go(1) },
            onLeft = { go(0) },
            onRight = { go(1) },
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
                focusRequester = focus[1],
                onFocused = { idx = 1 },
                onUp = { go(0) },
                onDown = { go(3) },
                onLeft = { go(1) },
                onRight = { go(2) },
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
                focusRequester = focus[2],
                onFocused = { idx = 2 },
                onUp = { go(0) },
                onDown = { go(3) },
                onLeft = { go(1) },
                onRight = { go(2) },
                onChange = { v -> cvv = v.filter { it.isDigit() }.take(4) },
            )
        }
        Spacer(Modifier.height(12.dp))

        TvCardField(
            label = "Nome impresso no cartão",
            value = holder,
            placeholder = "COMO ESTÁ NO CARTÃO",
            width = 520.dp,
            focusRequester = focus[3],
            onFocused = { idx = 3 },
            onUp = { go(1) },
            onDown = { go(4) },
            onLeft = { go(3) },
            onRight = { go(3) },
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
                focusRequester = focus[4],
                onFocused = { idx = 4 },
                onUp = { go(3) },
                onDown = { go(4) },
                onLeft = { go(4) },
                onRight = { go(5) },
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
            TvPixButton(
                "Voltar",
                enabled = !s.cardLoading,
                focusRequester = focus[5],
                onFocused = { idx = 5 },
                onUp = { go(3) },
                onDown = { go(5) },
                onLeft = { go(4) },
                onRight = { go(5) },
            ) {
                vm.clearCard()
                onBack()
            }
        }
    }
}

/**
 * Campo de texto com foco visível e navegação EXPLÍCITA para o D-pad.
 *
 * `BasicTextField` em vez de `TextField` do Material: o Material pensa em toque
 * (cursor, seleção com dedo) e na TV isso vira ruído visual. Aqui o que importa
 * é: o anel branco diz onde o foco está, e o texto é legível a 3 metros.
 *
 * ── POR QUE AS SETAS SÃO TRATADAS AQUI ───────────────────────────────────────
 * O `BasicTextField` consome DirectionLeft/Right para mover o cursor e não sabe
 * para onde ir em DirectionUp/Down. Se deixássemos o Compose decidir, o foco
 * ficaria preso no campo (era exatamente o bug relatado). Então cada seta é
 * interceptada, o foco é movido pelo `FocusRequester` do vizinho e a tecla é
 * consumida — o campo nunca "engole" a navegação.
 *
 * OK/ENTER abre o teclado na tela (o `BasicTextField` já faz isso ao receber o
 * foco; o pedido explícito garante o comportamento também quando o foco chega
 * por seta).
 */
@Composable
private fun TvCardField(
    label: String,
    value: String,
    placeholder: String,
    width: androidx.compose.ui.unit.Dp,
    keyboard: KeyboardType = KeyboardType.Text,
    focusRequester: FocusRequester,
    onFocused: () -> Unit,
    onUp: () -> Unit,
    onDown: () -> Unit,
    onLeft: () -> Unit,
    onRight: () -> Unit,
    onChange: (String) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val keyboardController = LocalSoftwareKeyboardController.current

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
                    .focusRequester(focusRequester)
                    .onFocusChanged {
                        focused = it.isFocused
                        if (it.isFocused) onFocused()
                    }
                    .onPreviewKeyEvent { ev ->
                        if (ev.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                        when (ev.key) {
                            Key.DirectionUp -> { onUp(); true }
                            Key.DirectionDown -> { onDown(); true }
                            Key.DirectionLeft -> { onLeft(); true }
                            Key.DirectionRight -> { onRight(); true }
                            Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> {
                                keyboardController?.show()
                                true
                            }
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
