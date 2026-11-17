import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await resetPassword(email.trim())
    setBusy(false)
    if (error) setError(error)
    else setSent(true)
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
          Informe seu e-mail e enviaremos um link para você criar uma nova senha.
        </p>

        {error && <div className="alert alert--error">{error}</div>}
        {sent && (
          <div className="alert alert--success">
            Se este e-mail estiver cadastrado, o link de recuperação foi enviado. Verifique sua
            caixa de entrada e o spam.
          </div>
        )}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com"
            />
          </div>
          <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar link'}
          </button>
        </form>

        <p className="auth-foot">
          <Link to="/login">Voltar ao login</Link>
        </p>
      </div>
    </div>
  )
}

export function ResetPasswordPage() {
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

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
    const { error } = await updatePassword(password)
    setBusy(false)
    if (error) setError(error)
    else setDone(true)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/icon-192.png" alt="" />
          <span className="brand-word">MovieFlix</span>
        </div>
        <h1 className="auth-title">Nova senha</h1>
        <p className="auth-sub">Defina uma nova senha para sua conta.</p>

        {error && <div className="alert alert--error">{error}</div>}
        {done ? (
          <>
            <div className="alert alert--success">Senha atualizada com sucesso.</div>
            <Link to="/login" className="btn btn--primary btn--block btn--lg">
              Entrar
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="password">Nova senha</label>
              <input
                id="password"
                className="input"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirmar nova senha</label>
              <input
                id="confirm"
                className="input"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar nova senha'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
