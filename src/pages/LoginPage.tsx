import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { PasswordField } from '../components/PasswordField'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) setError(error)
    else navigate(from, { replace: true })
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/icon-192.png" alt="" />
          <span className="brand-word">MovieFlix</span>
        </div>
        <h1 className="auth-title">Entrar na sua conta</h1>
        <p className="auth-sub">Acesse favoritos, histórico e continue de onde parou.</p>

        {error && <div className="alert alert--error">{error}</div>}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com"
            />
          </div>
          <PasswordField
            id="password"
            label="Senha"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="auth-foot">
          <Link to="/recuperar-senha">Esqueci minha senha</Link>
        </p>
        <p className="auth-foot">
          Não tem conta? <Link to="/cadastro">Cadastre-se grátis</Link>
        </p>
        <p className="auth-foot" style={{ marginTop: 8 }}>
          <Link to="/">Continuar sem conta →</Link>
        </p>
      </div>
    </div>
  )
}
