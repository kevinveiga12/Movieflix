package run.velixir.movieflix.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import run.velixir.movieflix.AppViewModel
import run.velixir.movieflix.ui.theme.MfColors

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
        label = { Text(label, color = MfColors.TextDim) },
        singleLine = true,
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 12.dp),
    )
}

@Composable
private fun MfButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (enabled) MfColors.Red else MfColors.BgHover)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
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
        Spacer(Modifier.height(40.dp))
        Text("MOVIEFLIX", color = MfColors.Red, fontSize = 30.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(6.dp))
        Text("Entre para continuar assistindo", color = MfColors.TextMuted, fontSize = 13.sp)
        Spacer(Modifier.height(32.dp))

        if (err != null) {
            Text(err!!, color = MfColors.Danger, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
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
            fontSize = 13.sp,
            modifier = Modifier.clickable(onClick = onForgot),
        )
        Spacer(Modifier.height(24.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Não tem conta? ", color = MfColors.TextMuted, fontSize = 13.sp)
            Text(
                "Criar conta",
                color = MfColors.Red,
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
        Text("Criar conta", color = MfColors.Text, fontSize = 24.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(6.dp))
        Text(
            "Sua conta dá 1 mês de acesso grátis a todo o catálogo.",
            color = MfColors.TextMuted,
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(28.dp))

        if (ok) {
            Text(
                "Conta criada! Faça login para começar.",
                color = MfColors.Success,
                fontSize = 14.sp,
                modifier = Modifier.padding(bottom = 16.dp),
            )
            MfButton("Ir para o login") { onDone() }
            return@Column
        }

        if (err != null) {
            Text(err!!, color = MfColors.Danger, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
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
        Text("Recuperar senha", color = MfColors.Text, fontSize = 22.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(20.dp))

        if (msg != null) {
            Text(msg!!, color = MfColors.Success, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
        }
        if (err != null) {
            Text(err!!, color = MfColors.Danger, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
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
            fontSize = 13.sp,
            modifier = Modifier.clickable(onClick = onBack),
        )
    }
}

@Composable
fun AccountScreen(vm: AppViewModel, onLogin: () -> Unit, onPlans: () -> Unit) {
    val s by vm.state.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        Text("Minha conta", color = MfColors.Text, fontSize = 22.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(20.dp))

        if (!s.loggedIn) {
            Text("Você não está logado.", color = MfColors.TextMuted, fontSize = 14.sp)
            Spacer(Modifier.height(16.dp))
            MfButton("Entrar") { onLogin() }
            return@Column
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(MfColors.BgCard)
                .padding(16.dp),
        ) {
            Column {
                Text(s.email ?: "", color = MfColors.Text, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(6.dp))
                val sub = s.subscription
                val label = when {
                    sub == null -> "Verificando acesso…"
                    sub.allowed && sub.reason == "plan" -> "Plano ativo"
                    sub.allowed -> "Mês grátis · ${sub.daysLeft ?: 0} dias restantes"
                    else -> "Acesso encerrado"
                }
                Text(label, color = if (sub?.allowed == true) MfColors.Success else MfColors.Warning, fontSize = 13.sp)
            }
        }

        Spacer(Modifier.height(16.dp))
        MfButton("Ver planos") { onPlans() }
        Spacer(Modifier.height(12.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(MfColors.BgCard)
                .clickable { vm.logout() }
                .padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("Sair da conta", color = MfColors.TextSoft, fontSize = 14.sp)
        }
    }
}

@Composable
fun PlansScreen(vm: AppViewModel) {
    val s by vm.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { vm.loadPlans() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        Text("Planos", color = MfColors.Text, fontSize = 22.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(6.dp))
        Text(
            "Escolha o plano e fale com a gente pelo WhatsApp.",
            color = MfColors.TextMuted,
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(20.dp))

        if (s.plans.isEmpty()) {
            Text("Carregando planos…", color = MfColors.TextDim, fontSize = 13.sp)
        }

        s.plans.forEach { plan ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 14.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(MfColors.BgCard)
                    .padding(16.dp),
            ) {
                Column {
                    Text(plan.name, color = MfColors.Text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    if (!plan.description.isNullOrBlank()) {
                        Text(plan.description!!, color = MfColors.TextMuted, fontSize = 12.sp)
                    }
                    Spacer(Modifier.height(10.dp))
                    plan.periods.forEach { p ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(p.label, color = MfColors.TextSoft, fontSize = 13.sp, modifier = Modifier.width(80.dp))
                            Text(p.priceLabel, color = MfColors.Text, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                            if (!p.savedLabel.isNullOrBlank()) {
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "economize ${p.savedLabel}",
                                    color = MfColors.Success,
                                    fontSize = 11.sp,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
