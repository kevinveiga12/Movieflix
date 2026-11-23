import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { PasswordField } from '../components/PasswordField'

/**
 * Recuperação de senha por CÓDIGO de 6 dígitos.
 *
 * Antes era um link mágico: o Supabase enviava um e-mail com URL de retorno e o
 * usuário precisava clicar. Com o SMTP padrão do projeto nada chegava, então a
 * recuperação simplesmente não funcionava. Agora o servidor gera o código pela
 * API administrativa, envia por e-mail e o usuário digita aqui — o mesmo fluxo
 * funciona no celular e no computador, sem depender de deep link.
 *
 * O código é validado pelo próprio Supabase (`verifyOtp`), não por nós.
 */
export function ForgotPasswordPage() {
  const { requestCode } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onRequest(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    const { error, sent } = await requestCode(email.trim())
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    setStep('code')
    setInfo(
      sent
        ? 'Enviamos um código de 6 dígitos para o seu e-mail. Ele vale por 15 minutos.'
        : 'Se este e-mail estiver cadastrado, o código será enviado.',
    )
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/icon-192.png" alt="" />
          <span className="brand-word">MovieFlix</span>
        </div>
        <h1 className="auth-title">Recuperar senha</h1>
        <p className="auth-sub">
          {step === 'email'
            ? 'Informe seu e-mail e enviaremos um código de 6 dígitos.'
            : 'Digite o código que chegou no seu e-mail.'}
        </p>

        {error && <div className="alert alert--error">{error}</div>}
        {info && <div className="alert alert--success">{info}</div>}

        {step === 'email' ? (
          <form onSubmit={onRequest}>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input
                id="email"
                className="input"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
              />
            </div>
            <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={busy}>
              {busy ? 'Enviando…' : 'Enviar código'}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              navigate('/redefinir-senha', { state: { email: email.trim(), code } })
            }}
          >
            <div className="field">
              <label htmlFor="code">Código de 6 dígitos</label>
              <input
                id="code"
                className="input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                style={{ letterSpacing: 8, fontSize: 22, textAlign: 'center' }}
              />
            </div>
            <button
              className="btn btn--primary btn--block btn--lg"
              type="submit"
              disabled={busy || code.length !== 6}
            >
              Continuar
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              style={{ marginTop: 10 }}
              onClick={() => {
                setStep('email')
                setCode('')
                setInfo(null)
                setError(null)
              }}
            >
              Usar outro e-mail
            </button>
          </form>
        )}

        <p className="auth-foot">
          <Link to="/login">Voltar ao login</Link>
        </p>
      </div>
    </div>
  )
}

/**
 * Define a nova senha usando o código recebido.
 *
 * O e-mail e o código chegam por `location.state` (vindos da tela anterior) ou
 * pela query string, para o caso de o usuário recarregar a página.
 */
export function ResetPasswordPage() {
  const { verifyCode } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  // Preenche a partir do state da navegação (ou da URL, se recarregou).
  // `useState` com inicializador só roda uma vez, no primeiro render — é o
  // lugar certo para ler o state da navegação sem disparar re-render.
  useState(() => {
    const nav = (window.history.state as { usr?: { email?: string; code?: string } } | null)?.usr
    const params = new URLSearchParams(window.location.search)
    const qEmail = nav?.email ?? params.get('email')
    const qCode = nav?.code ?? params.get('code')
    if (qEmail) setEmail(qEmail)
    if (qCode) setCode(qCode.replace(/\D/g, '').slice(0, 6))
    return null
  })

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    setBusy(true)
    const { error } = await verifyCode(email.trim(), code, password)
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    setDone(true)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/icon-192.png" alt="" />
          <span className="brand-word">MovieFlix</span>
        </div>
        <h1 className="auth-title">Nova senha</h1>
        <p className="auth-sub">Confirme o código e defina sua nova senha.</p>

        {error && <div className="alert alert--error">{error}</div>}

        {done ? (
          <>
            <div className="alert alert--success">Senha atualizada com sucesso.</div>
            <button
              className="btn btn--primary btn--block btn--lg"
              onClick={() => navigate('/login', { replace: true })}
            >
              Entrar
            </button>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input
                id="email"
                className="input"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
              />
            </div>
            <div className="field">
              <label htmlFor="code">Código de 6 dígitos</label>
              <input
                id="code"
                className="input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                style={{ letterSpacing: 8, fontSize: 22, textAlign: 'center' }}
              />
            </div>
            <PasswordField
              id="password"
              label="Nova senha"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              hint="Use pelo menos 6 caracteres."
            />
            <PasswordField
              id="confirm"
              label="Confirmar nova senha"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />
            <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar nova senha'}
            </button>
          </form>
        )}

        <p className="auth-foot">
          <Link to="/recuperar-senha">Pedir outro código</Link>
        </p>
      </div>
    </div>
  )
}
