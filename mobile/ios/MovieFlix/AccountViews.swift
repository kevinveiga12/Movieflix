import SwiftUI

// MARK: - Login

struct LoginView: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false
    @State private var showSignup = false
    @State private var showForgot = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 40)

                Text("MOVIEFLIX")
                    .font(.system(size: 30, weight: .black))
                    .foregroundStyle(MF.red)
                Text("Entre para continuar assistindo")
                    .font(.system(size: 13))
                    .foregroundStyle(MF.textMuted)
                    .padding(.top, 6)

                Spacer().frame(height: 32)

                if let e = error {
                    Text(e)
                        .font(.system(size: 13))
                        .foregroundStyle(MF.danger)
                        .padding(.bottom, 12)
                }

                MFField(label: "E-mail", text: $email, keyboard: .emailAddress)
                    .padding(.bottom, 12)
                MFField(label: "Senha", text: $password, secure: true)

                Button {
                    busy = true
                    error = nil
                    Task {
                        let err = await app.login(email: email, password: password)
                        busy = false
                        if let err { error = err } else { dismiss() }
                    }
                } label: {
                    Text(busy ? "Entrando…" : "Entrar")
                }
                .buttonStyle(MFButtonStyle())
                .disabled(busy || email.isEmpty || password.isEmpty)
                .padding(.top, 20)

                Button("Esqueci minha senha") { showForgot = true }
                    .font(.system(size: 13))
                    .foregroundStyle(MF.textMuted)
                    .padding(.top, 18)

                HStack(spacing: 4) {
                    Text("Não tem conta?").foregroundStyle(MF.textMuted)
                    Button("Criar conta") { showSignup = true }
                        .foregroundStyle(MF.red)
                        .fontWeight(.bold)
                }
                .font(.system(size: 13))
                .padding(.top, 24)
            }
            .padding(24)
        }
        .background(MF.bg)
        .sheet(isPresented: $showSignup) { SignupView() }
        .sheet(isPresented: $showForgot) { ForgotPasswordView() }
    }
}

// MARK: - Cadastro

struct SignupView: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var success = false
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 40)

                Text("Criar conta")
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(MF.text)
                Text("Sua conta dá 1 mês de acesso grátis a todo o catálogo.")
                    .font(.system(size: 13))
                    .foregroundStyle(MF.textMuted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 6)

                Spacer().frame(height: 28)

                if success {
                    Text("Conta criada! Faça login para começar.")
                        .font(.system(size: 14))
                        .foregroundStyle(MF.success)
                        .padding(.bottom, 16)
                    Button("Ir para o login") { dismiss() }
                        .buttonStyle(MFButtonStyle())
                } else {
                    if let e = error {
                        Text(e)
                            .font(.system(size: 13))
                            .foregroundStyle(MF.danger)
                            .padding(.bottom, 12)
                    }

                    MFField(label: "Nome", text: $name).padding(.bottom, 12)
                    MFField(label: "E-mail", text: $email, keyboard: .emailAddress).padding(.bottom, 12)
                    MFField(label: "Senha (mínimo 6 caracteres)", text: $password, secure: true)

                    Button {
                        busy = true
                        error = nil
                        Task {
                            let err = await app.signup(email: email, password: password, name: name)
                            busy = false
                            if let err { error = err } else { success = true }
                        }
                    } label: {
                        Text(busy ? "Criando…" : "Criar conta")
                    }
                    .buttonStyle(MFButtonStyle())
                    .disabled(busy || email.isEmpty || password.count < 6)
                    .padding(.top, 20)
                }
            }
            .padding(24)
        }
        .background(MF.bg)
    }
}

// MARK: - Recuperar senha

struct ForgotPasswordView: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var code = ""
    @State private var newPassword = ""
    @State private var step = 1
    @State private var message: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 40)

                Text("Recuperar senha")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(MF.text)

                Spacer().frame(height: 20)

                if let m = message {
                    Text(m).font(.system(size: 13)).foregroundStyle(MF.success).padding(.bottom, 12)
                }
                if let e = error {
                    Text(e).font(.system(size: 13)).foregroundStyle(MF.danger).padding(.bottom, 12)
                }

                if step == 1 {
                    MFField(label: "E-mail da conta", text: $email, keyboard: .emailAddress)
                    Button("Enviar código") {
                        error = nil
                        Task {
                            let err = await app.requestCode(email)
                            if let err { error = err } else {
                                step = 2
                                message = "Enviamos um código para seu e-mail."
                            }
                        }
                    }
                    .buttonStyle(MFButtonStyle())
                    .disabled(email.isEmpty)
                    .padding(.top, 20)
                } else {
                    MFField(label: "Código de 6 dígitos", text: $code, keyboard: .numberPad)
                        .padding(.bottom, 12)
                    MFField(label: "Nova senha", text: $newPassword, secure: true)

                    Button("Redefinir senha") {
                        error = nil
                        Task {
                            let err = await app.verifyCode(email: email, code: code, newPassword: newPassword)
                            if let err { error = err } else {
                                message = "Senha alterada. Faça login."
                                dismiss()
                            }
                        }
                    }
                    .buttonStyle(MFButtonStyle())
                    .disabled(code.isEmpty || newPassword.count < 6)
                    .padding(.top, 20)
                }

                Button("Voltar") { dismiss() }
                    .font(.system(size: 13))
                    .foregroundStyle(MF.textMuted)
                    .padding(.top, 20)
            }
            .padding(24)
        }
        .background(MF.bg)
    }
}

// MARK: - Conta

struct AccountView: View {
    @EnvironmentObject var app: AppState
    @State private var showLogin = false
    @State private var showPlans = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Minha conta")
                        .font(.system(size: 22, weight: .black))
                        .foregroundStyle(MF.text)

                    if !app.loggedIn {
                        Text("Você não está logado.")
                            .font(.system(size: 14))
                            .foregroundStyle(MF.textMuted)
                        Button("Entrar") { showLogin = true }
                            .buttonStyle(MFButtonStyle())
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(app.email ?? "")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(MF.text)

                            Text(accessLabel)
                                .font(.system(size: 13))
                                .foregroundStyle(accessColor)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(MF.bgCard)
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                        Button("Ver planos") { showPlans = true }
                            .buttonStyle(MFButtonStyle())

                        Button("Sair da conta") { app.logout() }
                            .buttonStyle(MFButtonStyle(primary: false))
                    }
                }
                .padding(20)
            }
            .background(MF.bg)
            .navigationTitle("Conta")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showLogin) { LoginView() }
            .sheet(isPresented: $showPlans) { PlansView() }
            .task { await app.loadSubscription() }
        }
    }

    private var accessLabel: String {
        guard let sub = app.subscription else { return "Verificando acesso…" }
        if sub.allowed && sub.reason == "plan" { return "Plano ativo" }
        if sub.allowed { return "Mês grátis · \(sub.daysLeft ?? 0) dias restantes" }
        return "Acesso encerrado"
    }

    private var accessColor: Color {
        (app.subscription?.allowed ?? false) ? MF.success : MF.warning
    }
}

// MARK: - Planos

struct PlansView: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Planos")
                        .font(.system(size: 22, weight: .black))
                        .foregroundStyle(MF.text)
                    Text("Escolha o plano e fale com a gente pelo WhatsApp.")
                        .font(.system(size: 13))
                        .foregroundStyle(MF.textMuted)

                    if app.plans.isEmpty {
                        Text("Carregando planos…")
                            .font(.system(size: 13))
                            .foregroundStyle(MF.textDim)
                    }

                    ForEach(app.plans) { plan in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(plan.name)
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(MF.text)
                            if let d = plan.description {
                                Text(d).font(.system(size: 12)).foregroundStyle(MF.textMuted)
                            }
                            ForEach(plan.periods) { p in
                                HStack(spacing: 8) {
                                    Text(p.label)
                                        .font(.system(size: 13))
                                        .foregroundStyle(MF.textSoft)
                                        .frame(width: 80, alignment: .leading)
                                    Text(p.priceLabel)
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundStyle(MF.text)
                                    if let saved = p.savedLabel, !saved.isEmpty {
                                        Text("economize \(saved)")
                                            .font(.system(size: 11))
                                            .foregroundStyle(MF.success)
                                    }
                                    Spacer()
                                    if let url = URL(string: p.whatsappUrl) {
                                        Link(destination: url) {
                                            Text("Assinar")
                                                .font(.system(size: 12, weight: .bold))
                                                .foregroundStyle(.white)
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 6)
                                                .background(MF.red)
                                                .clipShape(Capsule())
                                        }
                                    }
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(MF.bgCard)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                }
                .padding(20)
            }
            .background(MF.bg)
            .navigationTitle("Planos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Fechar") { dismiss() }.foregroundStyle(MF.red)
                }
            }
            .task { await app.loadPlans() }
        }
    }
}
