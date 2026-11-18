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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import run.velixir.movieflix.AppViewModel
import run.velixir.movieflix.ui.MfLogo
import run.velixir.movieflix.ui.SectionTitle
import run.velixir.movieflix.ui.theme.MfColors
import run.velixir.movieflix.ui.theme.MfSans

/* ==========================================================================
   Conta, autenticação, planos, perfis e configurações.

   Rotas do site cobertas:
     /login  /cadastro  /recuperar-senha
     /perfil  /configuracoes  /planos
   ========================================================================== */

@Composable
private fun MfField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    password: Boolean = false,
    keyboard: KeyboardType = KeyboardType.Text,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label, color = MfColors.TextDim, fontSize = 13.sp) },
        singleLine = true,
        visualTransformation = if (password) PasswordVisualTransformation()
        else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        shape = RoundedCornerShape(10.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MfColors.Red,
            unfocusedBorderColor = MfColors.Border,
            focusedContainerColor = MfColors.BgCard,
            unfocusedContainerColor = MfColors.BgCard,
            focusedTextColor = MfColors.Text,
            unfocusedTextColor = MfColors.Text,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 12.dp),
    )
}

@Composable
private fun MfButton(
    text: String,
    enabled: Boolean = true,
    primary: Boolean = true,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    !enabled -> MfColors.BgHover
                    primary -> MfColors.Red
                    else -> MfColors.BgCard
                },
            )
            .then(
                if (!primary && enabled) Modifier.border(1.dp, MfColors.Border, RoundedCornerShape(10.dp))
                else Modifier,
            )
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = if (enabled) Color.White else MfColors.TextDim,
            fontFamily = MfSans,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
        )
    }
}

@Composable
fun LoginScreen(vm: AppViewModel, onDone: () -> Unit, onSignup: () -> Unit, onForgot: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        MfLogo(fontSize = 30, iconSize = 46)
        Spacer(Modifier.height(10.dp))
        Text(
            "Entre para continuar assistindo",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(32.dp))

        if (err != null) {
            Text(
                err!!,
                color = MfColors.Danger,
                fontFamily = MfSans,
                fontSize = 13.sp,
                modifier = Modifier.padding(bottom = 12.dp),
            )
        }

        MfField(email, { email = it }, "E-mail", keyboard = KeyboardType.Email)
        MfField(pass, { pass = it }, "Senha", password = true)

        MfButton(if (busy) "Entrando…" else "Entrar", enabled = !busy && email.isNotBlank() && pass.isNotBlank()) {
            busy = true
            err = null
            vm.login(email, pass) { e ->
                busy = false
                if (e == null) onDone() else err = e
            }
        }

        Spacer(Modifier.height(18.dp))
        Text(
            "Esqueci minha senha",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 13.sp,
            modifier = Modifier.clickable(onClick = onForgot),
        )
        Spacer(Modifier.height(26.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Não tem conta? ", color = MfColors.TextMuted, fontFamily = MfSans, fontSize = 13.sp)
            Text(
                "Criar conta",
                color = MfColors.Red,
                fontFamily = MfSans,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.clickable(onClick = onSignup),
            )
        }
    }
}

@Composable
fun SignupScreen(vm: AppViewModel, onDone: () -> Unit, onBack: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var err by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(40.dp))
        MfLogo(fontSize = 26, iconSize = 40)
        Spacer(Modifier.height(18.dp))
        Text(
            "Criar conta",
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 22.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Sua conta dá 1 mês de acesso grátis a todo o catálogo.",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 12.sp,
        )
        Spacer(Modifier.height(26.dp))

        if (ok) {
            Text(
                "Conta criada! Faça login para começar.",
                color = MfColors.Success,
                fontFamily = MfSans,
                fontSize = 14.sp,
                modifier = Modifier.padding(bottom = 16.dp),
            )
            MfButton("Ir para o login") { onDone() }
            return@Column
        }

        if (err != null) {
            Text(
                err!!,
                color = MfColors.Danger,
                fontFamily = MfSans,
                fontSize = 13.sp,
                modifier = Modifier.padding(bottom = 12.dp),
            )
        }

        MfField(name, { name = it }, "Nome")
        MfField(email, { email = it }, "E-mail", keyboard = KeyboardType.Email)
        MfField(pass, { pass = it }, "Senha (mínimo 6 caracteres)", password = true)

        MfButton(
            if (busy) "Criando…" else "Criar conta",
            enabled = !busy && email.isNotBlank() && pass.length >= 6,
        ) {
            busy = true
            err = null
            vm.signup(email, pass, name) { e ->
                busy = false
                if (e == null) ok = true else err = e
            }
        }

        Spacer(Modifier.height(18.dp))
        Text(
            "Já tenho conta",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 13.sp,
            modifier = Modifier.clickable(onClick = onBack),
        )
    }
}

@Composable
fun ForgotScreen(vm: AppViewModel, onBack: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var newPass by remember { mutableStateOf("") }
    var step by remember { mutableStateOf(1) }
    var msg by remember { mutableStateOf<String?>(null) }
    var err by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(40.dp))
        MfLogo(fontSize = 24, iconSize = 38)
        Spacer(Modifier.height(18.dp))
        Text(
            "Recuperar senha",
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 20.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(20.dp))

        if (msg != null) {
            Text(
                msg!!,
                color = MfColors.Success,
                fontFamily = MfSans,
                fontSize = 13.sp,
                modifier = Modifier.padding(bottom = 12.dp),
            )
        }
        if (err != null) {
            Text(
                err!!,
                color = MfColors.Danger,
                fontFamily = MfSans,
                fontSize = 13.sp,
                modifier = Modifier.padding(bottom = 12.dp),
            )
        }

        if (step == 1) {
            MfField(email, { email = it }, "E-mail da conta", keyboard = KeyboardType.Email)
            MfButton("Enviar código", enabled = email.isNotBlank()) {
                err = null
                vm.requestCode(email) { e ->
                    if (e == null) {
                        step = 2
                        msg = "Enviamos um código para seu e-mail."
                    } else err = e
                }
            }
        } else {
            MfField(code, { code = it }, "Código de 6 dígitos", keyboard = KeyboardType.Number)
            MfField(newPass, { newPass = it }, "Nova senha", password = true)
            MfButton("Redefinir senha", enabled = code.isNotBlank() && newPass.length >= 6) {
                err = null
                vm.verifyCode(email, code, newPass) { e ->
                    if (e == null) {
                        msg = "Senha alterada. Faça login."
                        onBack()
                    } else err = e
                }
            }
        }

        Spacer(Modifier.height(20.dp))
        Text(
            "Voltar",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 13.sp,
            modifier = Modifier.clickable(onClick = onBack),
        )
    }
}

/** Linha de menu da conta — o `.account-row` do site. */
@Composable
private fun AccountRow(
    icon: String,
    label: String,
    detail: String? = null,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MfColors.BgCard)
            .border(1.dp, MfColors.Border, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(icon, fontSize = 16.sp)
        Spacer(Modifier.width(12.dp))
        Text(
            label,
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.weight(1f))
        if (detail != null) {
            Text(detail, color = MfColors.TextDim, fontFamily = MfSans, fontSize = 12.sp)
            Spacer(Modifier.width(6.dp))
        }
        Text("›", color = MfColors.TextDim, fontSize = 18.sp)
    }
}

@Composable
fun AccountScreen(
    vm: AppViewModel,
    onLogin: () -> Unit,
    onPlans: () -> Unit,
    onFavorites: () -> Unit = {},
    onHistory: () -> Unit = {},
    onSettings: () -> Unit = {},
    onProfiles: () -> Unit = {},
) {
    val s by vm.state.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        MfLogo(fontSize = 22, iconSize = 28)
        Spacer(Modifier.height(18.dp))
        Text(
            "Minha conta",
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 24.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(16.dp))

        if (!s.loggedIn) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(MfColors.BgCard)
                    .border(1.dp, MfColors.Border, RoundedCornerShape(14.dp))
                    .padding(20.dp),
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    Box(
                        Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(MfColors.BgHover),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("👤", fontSize = 24.sp)
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Você não está logado",
                        color = MfColors.Text,
                        fontFamily = MfSans,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Entre para salvar favoritos e continuar de onde parou.",
                        color = MfColors.TextMuted,
                        fontFamily = MfSans,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(16.dp))
                    MfButton("Entrar") { onLogin() }
                }
            }
            return@Column
        }

        // Cartão do perfil — o .account-card do site.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(MfColors.BgCard)
                .border(1.dp, MfColors.Border, RoundedCornerShape(14.dp))
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(MfColors.Red),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    (s.email ?: "?").trim().firstOrNull()?.uppercase() ?: "?",
                    color = Color.White,
                    fontFamily = MfSans,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Black,
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    s.email ?: "",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(4.dp))
                val sub = s.subscription
                val label = when {
                    sub == null -> "Verificando acesso…"
                    sub.allowed && sub.reason == "plan" -> "Plano ativo"
                    sub.allowed -> "Mês grátis · ${sub.daysLeft ?: 0} dias restantes"
                    else -> "Acesso encerrado"
                }
                Text(
                    label,
                    color = if (sub?.allowed == true) MfColors.Success else MfColors.Warning,
                    fontFamily = MfSans,
                    fontSize = 12.sp,
                )
            }
        }

        Spacer(Modifier.height(18.dp))
        SectionTitle("Conta", modifier = Modifier.padding(start = 0.dp, end = 0.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AccountRow("👥", "Perfis", onClick = onProfiles)
            AccountRow("♡", "Favoritos", onClick = onFavorites)
            AccountRow("🕒", "Histórico", onClick = onHistory)
            AccountRow("💳", "Planos e assinatura", onClick = onPlans)
            AccountRow("⚙", "Configurações", onClick = onSettings)
        }

        Spacer(Modifier.height(18.dp))
        MfButton("Sair da conta", primary = false) { vm.logout() }
        Spacer(Modifier.height(24.dp))
    }
}

/** Perfis — a rota /perfil do site. */
@Composable
fun ProfilesScreen(vm: AppViewModel, onBack: () -> Unit) {
    val s by vm.state.collectAsState()

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
                "Perfis",
                color = MfColors.Text,
                fontFamily = MfSans,
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
            )
        }
        Spacer(Modifier.height(18.dp))

        if (!s.loggedIn) {
            Text(
                "Entre na sua conta para gerenciar perfis.",
                color = MfColors.TextMuted,
                fontFamily = MfSans,
                fontSize = 13.sp,
            )
            return@Column
        }

        // O site usa um perfil por conta (profiles). Mostramos o perfil real
        // da conta logada — não inventamos perfis que não existem no banco.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(MfColors.BgCard)
                .border(2.dp, MfColors.Red, RoundedCornerShape(14.dp))
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(52.dp)
                    .clip(CircleShape)
                    .background(MfColors.Red),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    (s.email ?: "?").trim().firstOrNull()?.uppercase() ?: "?",
                    color = Color.White,
                    fontFamily = MfSans,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Black,
                )
            }
            Spacer(Modifier.width(14.dp))
            Column {
                Text(
                    s.email ?: "",
                    color = MfColors.Text,
                    fontFamily = MfSans,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    if (s.isAdmin) "Administrador" else "Perfil principal",
                    color = MfColors.TextMuted,
                    fontFamily = MfSans,
                    fontSize = 12.sp,
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        Text(
            "O MovieFlix usa um perfil por conta. Para assistir em outra pessoa, " +
                "crie uma conta separada — favoritos e histórico ficam ligados à conta.",
            color = MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 12.sp,
            lineHeight = 18.sp,
        )
    }
}

/** Configurações — a rota /configuracoes do site. */
@Composable
fun SettingsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val s by vm.state.collectAsState()
    var autoplay by remember { mutableStateOf(true) }
    var wifiOnly by remember { mutableStateOf(false) }
    var notifications by remember { mutableStateOf(true) }

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
                "Configurações",
                color = MfColors.Text,
                fontFamily = MfSans,
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
            )
        }
        Spacer(Modifier.height(18.dp))

        SectionTitle("Reprodução", modifier = Modifier.padding(start = 0.dp, end = 0.dp))
        SettingSwitch("Reproduzir automaticamente", "Inicia o próximo episódio sozinho", autoplay) {
            autoplay = it
        }
        Spacer(Modifier.height(8.dp))
        SettingSwitch("Só em Wi-Fi", "Evita gastar dados móveis", wifiOnly) { wifiOnly = it }

        Spacer(Modifier.height(20.dp))
        SectionTitle("Notificações", modifier = Modifier.padding(start = 0.dp, end = 0.dp))
        SettingSwitch("Novidades e lançamentos", "Avisos de novos títulos", notifications) {
            notifications = it
        }

        Spacer(Modifier.height(20.dp))
        SectionTitle("Conta", modifier = Modifier.padding(start = 0.dp, end = 0.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AccountRow("📧", "E-mail", detail = s.email ?: "não logado") {}
            AccountRow("🔐", "Alterar senha", onClick = {})
            AccountRow("📄", "Termos e privacidade", onClick = {})
        }

        Spacer(Modifier.height(24.dp))
        Text(
            "MovieFlix 1.0.0 · Filmes e séries dublados em pt-BR",
            color = MfColors.TextDim,
            fontFamily = MfSans,
            fontSize = 11.sp,
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun SettingSwitch(label: String, detail: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MfColors.BgCard)
            .border(1.dp, MfColors.Border, RoundedCornerShape(10.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                label,
                color = MfColors.Text,
                fontFamily = MfSans,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(detail, color = MfColors.TextDim, fontFamily = MfSans, fontSize = 11.sp)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = MfColors.Red,
                uncheckedThumbColor = MfColors.TextDim,
                uncheckedTrackColor = MfColors.BgHover,
            ),
        )
    }
}

/** Planos — a rota /planos do site, com os descontos de 3 meses e 1 ano. */
@Composable
fun PlansScreen(vm: AppViewModel) {
    val s by vm.state.collectAsState()
    LaunchedEffect(Unit) { vm.loadPlans() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        MfLogo(fontSize = 22, iconSize = 28)
        Spacer(Modifier.height(16.dp))
        Text(
            "Planos",
            color = MfColors.Text,
            fontFamily = MfSans,
            fontSize = 24.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Escolha o plano e fale com a gente pelo WhatsApp.",
            color = MfColors.TextMuted,
            fontFamily = MfSans,
            fontSize = 12.sp,
        )
        Spacer(Modifier.height(18.dp))

        if (s.plans.isEmpty()) {
            Text(
                "Carregando planos…",
                color = MfColors.TextDim,
                fontFamily = MfSans,
                fontSize = 13.sp,
            )
        }

        s.plans.forEach { plan ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(MfColors.BgCard)
                    .border(1.dp, MfColors.Border, RoundedCornerShape(14.dp))
                    .padding(16.dp),
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            plan.name,
                            color = MfColors.Text,
                            fontFamily = MfSans,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            plan.priceLabel,
                            color = MfColors.Red,
                            fontFamily = MfSans,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Black,
                        )
                    }
                    if (!plan.description.isNullOrBlank()) {
                        Spacer(Modifier.height(3.dp))
                        Text(
                            plan.description!!,
                            color = MfColors.TextMuted,
                            fontFamily = MfSans,
                            fontSize = 11.sp,
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    plan.periods.forEach { p ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                p.label,
                                color = MfColors.TextSoft,
                                fontFamily = MfSans,
                                fontSize = 12.sp,
                                modifier = Modifier.width(72.dp),
                            )
                            if (!p.fullLabel.isNullOrBlank()) {
                                Text(
                                    p.fullLabel!!,
                                    color = MfColors.TextDim,
                                    fontFamily = MfSans,
                                    fontSize = 11.sp,
                                    textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough,
                                )
                                Spacer(Modifier.width(7.dp))
                            }
                            Text(
                                p.priceLabel,
                                color = MfColors.Text,
                                fontFamily = MfSans,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                            )
                            if (!p.savedLabel.isNullOrBlank()) {
                                Spacer(Modifier.width(7.dp))
                                Text(
                                    "−${p.savedLabel}",
                                    color = MfColors.Success,
                                    fontFamily = MfSans,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(20.dp))
    }
}
