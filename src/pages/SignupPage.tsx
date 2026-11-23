import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { PasswordField } from '../components/PasswordField'

export function SignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
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
    const { error, needsConfirmation } = await signUp(email.trim(), password, name.trim())
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    if (needsConfirmation) setDone(true)
    else {
      /**
       * Conta criada. O mês grátis NÃO é mais automático: quem libera é o
       * administrador, por um código de 6 dígitos. Então o cliente vai direto
       * para a tela de planos, onde também encontra o caminho do WhatsApp.
       */
      try {
        sessionStorage.removeItem('mf_signup_trial')
      } catch {
        /* sem sessionStorage: segue o fluxo normal */
      }
      navigate('/planos', { replace: true })
    }
  }

  if (done) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="auth-logo">
            <img src="/icon-192.png" alt="" />
            <span className="brand-word">MovieFlix</span>
          </div>
          <h1 className="auth-title">Confirme seu e-mail</h1>
          <p className="auth-sub">
            Enviamos um link de confirmação para <strong>{email}</strong>. Abra o link para ativar
            sua conta e depois faça login.
          </p>
          <Link to="/login" className="btn btn--primary btn--block btn--lg">
            Ir para o login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/icon-192.png" alt="" />
          <span className="brand-word">MovieFlix</span>
        </div>
        <h1 className="auth-title">Criar conta</h1>
        <p className="auth-sub">
          O catálogo é livre. A conta serve para salvar favoritos e histórico.
        </p>

        {error && <div className="alert alert--error">{error}</div>}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">Nome</label>
            <input
              id="name"
              className="input"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
            />
          </div>
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
            autoComplete="new-password"
            placeholder="Mínimo 6 caracteres"
            hint="Use pelo menos 6 caracteres."
          />
          <PasswordField
            id="confirm"
            label="Confirmar senha"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            placeholder="Repita a senha"
          />
          <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={busy}>
            {busy ? 'Criando…' : 'Criar conta'}
          </button>
        </form>

        <p className="auth-foot">
          Já tem conta? <Link to="/login">Entrar</Link>
        </p>
      </div>
    </div>
  )
}
