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

/**
 * Links de distribuição dos aplicativos.
 *
 * Ficam `null` enquanto o instalador não existir de verdade. A página então
 * mostra "Em desenvolvimento" em vez de um botão que não baixa nada — um
 * botão falso é pior do que a ausência dele.
 *
 * Para publicar: gere o APK (veja mobile/android/BUILD.md e
 * tv/android/BUILD.md), coloque o arquivo em `public/apk/` e troque o `null`
 * pelo caminho, ex.: '/apk/movieflix-mobile-1.0.0.apk'.
 */
const APK_MOBILE_URL: string | null = '/apk/movieflix-mobile-1.0.0.apk'
const APK_TV_URL: string | null = '/apk/movieflix-tv-1.0.3.apk'
const IOS_URL: string | null = null

type AppEnv = 'web-desktop' | 'web-mobile' | 'app-android' | 'app-ios' | 'app-tv'

/**
 * Identifica o ambiente de quem está abrindo a página.
 *
 * Não confia só no User-Agent: os aplicativos se identificam de forma
 * explícita, e essa marca tem prioridade.
 *
 *  1. `?app=android|ios|tv` na URL — o app abre a página com esse parâmetro.
 *  2. Sufixo no User-Agent — `MovieFlixApp/1.0` (mobile) e
 *     `MovieFlixTV/1.0` (TV), que os WebViews dos apps enviam.
 *  3. `sessionStorage` — guarda a identificação enquanto a aba estiver
 *     aberta, para o caso de o usuário navegar para outra página e voltar.
 *     É de propósito `sessionStorage` e não `localStorage`: com
 *     `localStorage` um navegador que abrisse a página uma vez com
 *     `?app=tv` ficaria preso no modo TV para sempre.
 *  4. Por último, o User-Agent do navegador, só para separar desktop de mobile.
 */
function detectAppEnv(): AppEnv {
  if (typeof window === 'undefined') return 'web-desktop'

  const param = new URLSearchParams(window.location.search).get('app')
  if (param === 'android') return 'app-android'
  if (param === 'ios') return 'app-ios'
  if (param === 'tv') return 'app-tv'

  const ua = navigator.userAgent || ''
  if (/MovieFlixTV\//i.test(ua)) return 'app-tv'
  if (/MovieFlixApp\//i.test(ua)) {
    return /iPhone|iPad|iPod/i.test(ua) ? 'app-ios' : 'app-android'
  }

  try {
    const stored = window.sessionStorage.getItem('mf_app_env')
    if (stored === 'app-android' || stored === 'app-ios' || stored === 'app-tv') {
      return stored
    }
  } catch {
    /* sessionStorage bloqueado — segue para o User-Agent */
  }

  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ? 'web-mobile' : 'web-desktop'
}

export function DownloadPage() {
  const env = detectAppEnv()

  // Guarda a identificação para as próximas visitas dentro do app.
  if (typeof window !== 'undefined' && env.startsWith('app-')) {
    try {
      window.sessionStorage.setItem('mf_app_env', env)
    } catch {
      /* sem sessionStorage: a detecção por UA continua funcionando */
    }
  }

  // Cada ambiente vê só o que faz sentido para ele: quem já está no app
  // mobile não precisa baixar o app mobile.
  const showMobile = env !== 'app-android' && env !== 'app-ios'
  const showTv = env !== 'app-tv'

  return (
    <div className="page" style={{ paddingTop: 32, maxWidth: 900 }}>
      <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.2rem)', marginBottom: 8 }}>
        Baixar o MovieFlix
      </h1>
      <p className="muted" style={{ marginBottom: 28, fontSize: '0.92rem' }}>
        Escolha a plataforma. O site também funciona direto no navegador, sem instalar nada.
      </p>

      <div className="panel">
        <div className="panel-title">🌐 Continuar no site</div>
        <p className="panel-sub">
          O MovieFlix funciona no navegador do computador, do celular e da TV, sem instalar nada.
          É um PWA: no Chrome ou Safari você pode “Adicionar à tela de início” e usar como um app.
        </p>
        <div className="alert alert--info" style={{ marginBottom: 0 }}>
          <InfoIcon size={18} />
          <span>
            No Chrome (Android/desktop): menu ⋮ → “Instalar app”. No Safari (iOS): Compartilhar →
            “Adicionar à Tela de Início”.
          </span>
        </div>
      </div>

      {showMobile && (
        <div className="panel">
          <div className="row-between">
            <div>
              <div className="panel-title">📱 MovieFlix Mobile</div>
              <p className="panel-sub" style={{ marginBottom: 6 }}>
                Aplicativo para celular, com login, catálogo, favoritos e histórico
                sincronizados com sua conta.
              </p>
              <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                Android 8.0 ou superior · iPhone com iOS 16 ou superior.
              </p>
            </div>
            <span className="badge badge--outline">
              {APK_MOBILE_URL || IOS_URL ? 'Disponível' : 'Em desenvolvimento'}
            </span>
          </div>

          {APK_MOBILE_URL ? (
            <div className="inline" style={{ marginTop: 14 }}>
              <a className="btn btn--primary" href={APK_MOBILE_URL} download>
                <DownloadIcon size={17} /> Baixar para Android
              </a>
              {IOS_URL && (
                <a className="btn btn--outline" href={IOS_URL} target="_blank" rel="noreferrer">
                  Instalar no iPhone
                </a>
              )}
            </div>
          ) : (
            <div className="alert alert--info" style={{ marginTop: 14, marginBottom: 0 }}>
              <InfoIcon size={18} />
              <span>
                O instalador ainda não foi publicado. O código do aplicativo está pronto
                e o processo de geração está documentado — enquanto isso, use o MovieFlix
                no navegador do celular, com todas as funções disponíveis.
              </span>
            </div>
          )}
        </div>
      )}

      {showTv && (
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
            <span className="badge badge--outline">
              {APK_TV_URL ? 'Disponível' : 'Em desenvolvimento'}
            </span>
          </div>

          {APK_TV_URL ? (
            <div className="inline" style={{ marginTop: 14 }}>
              <a className="btn btn--primary" href={APK_TV_URL} download>
                <DownloadIcon size={17} /> Baixar para TV
              </a>
            </div>
          ) : (
            <div className="alert alert--info" style={{ marginTop: 14, marginBottom: 0 }}>
              <InfoIcon size={18} />
              <span>
                O instalador para TV ainda não foi publicado. O código está pronto e o
                processo de geração está documentado — nas smart TVs, abra o navegador e
                acesse o site do MovieFlix.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
