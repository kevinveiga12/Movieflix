import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { DownloadIcon, CheckIcon, InfoIcon } from '../components/Icons'

export function SettingsPage() {
  const { user, updatePassword, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (password.length < 6) {
      setMsg({ type: 'error', text: 'A senha precisa ter pelo menos 6 caracteres.' })
      return
    }
    if (password !== confirm) {
      setMsg({ type: 'error', text: 'As senhas não coincidem.' })
      return
    }
    setBusy(true)
    const { error } = await updatePassword(password)
    setBusy(false)
    if (error) setMsg({ type: 'error', text: error })
    else {
      setMsg({ type: 'success', text: 'Senha alterada com sucesso.' })
      setPassword('')
      setConfirm('')
    }
  }

  return (
    <div className="page" style={{ paddingTop: 32, maxWidth: 820 }}>
      <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.2rem)', marginBottom: 24 }}>
        Configurações
      </h1>

      <div className="panel">
        <div className="panel-title">Acesso</div>
        <p className="panel-sub">
          O MovieFlix é <strong>totalmente gratuito</strong>. Todo o catálogo está liberado, sem
          planos, assinaturas ou cobranças. A conta serve apenas para favoritos e histórico.
        </p>
        <div className="inline">
          <span className="badge badge--purple">
            <CheckIcon size={12} /> Catálogo liberado
          </span>
          <span className="badge badge--outline">Sem anúncios</span>
          <span className="badge badge--outline">Dublado pt-BR</span>
        </div>
      </div>

      {user ? (
        <>
          <div className="panel">
            <div className="panel-title">Alterar senha</div>
            <p className="panel-sub">Use uma senha com pelo menos 6 caracteres.</p>
            {msg && <div className={`alert alert--${msg.type}`}>{msg.text}</div>}
            <form onSubmit={changePassword}>
              <div className="field">
                <label htmlFor="newpass">Nova senha</label>
                <input
                  id="newpass"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="confpass">Confirmar senha</label>
                <input
                  id="confpass"
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <button className="btn btn--primary" type="submit" disabled={busy}>
                {busy ? 'Salvando…' : 'Alterar senha'}
              </button>
            </form>
          </div>

          <div className="panel">
            <div className="panel-title">Sessão</div>
            <p className="panel-sub">Encerrar a sessão neste dispositivo.</p>
            <button className="btn btn--outline" onClick={() => void signOut()}>
              Sair da conta
            </button>
          </div>
        </>
      ) : (
        <div className="panel">
          <div className="panel-title">Conta</div>
          <p className="panel-sub">Você está navegando sem conta.</p>
          <div className="inline">
            <Link to="/login" className="btn btn--primary">
              Entrar
            </Link>
            <Link to="/cadastro" className="btn btn--outline">
              Criar conta
            </Link>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-title">Aplicativos</div>
        <p className="panel-sub">
          Instale o MovieFlix no celular, na TV ou use direto no navegador.
        </p>
        <Link to="/baixar-app" className="btn btn--outline">
          <DownloadIcon size={17} /> Ver aplicativos
        </Link>
      </div>

      <div className="panel">
        <div className="panel-title">Sobre</div>
        <p className="panel-sub" style={{ marginBottom: 0 }}>
          MovieFlix 2.0 · Metadados e imagens fornecidos pelo TMDB. Este produto usa a API do TMDB,
          mas não é endossado ou certificado pelo TMDB.
        </p>
      </div>
    </div>
  )
}

export function DownloadPage() {
  return (
    <div className="page" style={{ paddingTop: 32, maxWidth: 900 }}>
      <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.2rem)', marginBottom: 8 }}>
        Baixar o MovieFlix
      </h1>
      <p className="muted" style={{ marginBottom: 28, fontSize: '0.92rem' }}>
        Escolha a plataforma. O site também funciona direto no navegador, sem instalar nada.
      </p>

      <div className="panel">
        <div className="row-between">
          <div>
            <div className="panel-title">📱 MovieFlix Mobile</div>
            <p className="panel-sub" style={{ marginBottom: 6 }}>
              Aplicativo Android para assistir no celular, com login, catálogo,
              favoritos e histórico sincronizados com sua conta.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
              Compatível com Android 8.0 ou superior.
            </p>
          </div>
          <span className="badge badge--outline">Em desenvolvimento</span>
        </div>
        {/*
          Sem botão de download enquanto não existir APK publicado: um botão
          que não baixa nada é pior do que a ausência dele.
        */}
        <div className="alert alert--info" style={{ marginTop: 14, marginBottom: 0 }}>
          <InfoIcon size={18} />
          <span>
            A versão para celular ainda não tem instalador publicado. Enquanto
            isso, use o MovieFlix no navegador do celular — todas as funções
            estão disponíveis.
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="row-between">
          <div>
            <div className="panel-title">📺 MovieFlix TV</div>
            <p className="panel-sub" style={{ marginBottom: 6 }}>
              Versão para Android TV, Google TV e TV Box, com navegação pelo
              controle remoto.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
              Requer Android TV 8.0 ou superior.
            </p>
          </div>
          <span className="badge badge--outline">Em desenvolvimento</span>
        </div>
        <div className="alert alert--info" style={{ marginTop: 14, marginBottom: 0 }}>
          <InfoIcon size={18} />
          <span>
            A versão para TV ainda não tem instalador publicado. Nas smart TVs,
            abra o navegador e acesse o site do MovieFlix.
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">🌐 Usar no navegador</div>
        <p className="panel-sub">
          O MovieFlix é um PWA: no Chrome ou Safari você pode “Adicionar à tela de início” e usar
          como um app, sem baixar nada.
        </p>
        <div className="alert alert--info">
          <InfoIcon size={18} />
          <span>
            No Chrome (Android/desktop): menu ⋮ → “Instalar app”. No Safari (iOS): Compartilhar →
            “Adicionar à Tela de Início”.
          </span>
        </div>
      </div>
    </div>
  )
}
