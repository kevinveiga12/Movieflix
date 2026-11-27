import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { DownloadIcon, CheckIcon, InfoIcon } from '../components/Icons'
import { detectAppEnv, rememberAppEnv } from '../lib/appEnv'
import { PasswordField } from '../components/PasswordField'

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
              <PasswordField
                id="newpass"
                label="Nova senha"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                hint="Use pelo menos 6 caracteres."
              />
              <PasswordField
                id="confpass"
                label="Confirmar senha"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
              />
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
        <p className="panel-sub">Instale o MovieFlix no Android ou no iPhone e use como um app.</p>
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

/* ────────────────────────────────────────────────────────────────────────────
 * PÁGINA DE APLICATIVOS
 *
 * Três apps: Android, iPhone e TV. O de TV voltou a esta página a pedido do
 * proprietário, com o selo "Em desenvolvimento" — ele ainda não foi validado
 * num aparelho físico, e o aviso existe para que ninguém o trate como pronto.
 * O painel administrativo continua com a cópia dele.
 *
 * Ambos os apps são cascas que carregam o site publicado. Isso é o que garante
 * a regra "espelho": qualquer mudança no site aparece no app na próxima
 * abertura, sem gerar versão nova. Para o usuário não parecer um site, o app
 * abre sem barra de navegador, sem menu de contexto, em tela cheia, e o próprio
 * site troca de layout quando detecta `?app=` (ver src/lib/appEnv.ts).
 * ──────────────────────────────────────────────────────────────────────────── */

interface AppInfo {
  android: {
    available: boolean
    version: string
    minAndroid: string
    sizeBytes: number
    url: string
  }
  ios: { available: boolean; minIos: string; install: string }
  tv?: {
    available: boolean
    version: string
    minAndroid: string
    sizeBytes: number
    url: string
    status?: string
    notice?: string
    updateNote?: string
    platforms?: string[]
  }
}

/** Fallback: se /api/apps não responder, o botão do Android continua válido. */
const FALLBACK: AppInfo = {
  android: {
    available: true,
    version: '1.0.3',
    minAndroid: '8.0',
    sizeBytes: 0,
    url: '/apk/movieflix-android.apk',
  },
  ios: { available: true, minIos: '16.0', install: 'pwa' },
  tv: {
    available: true,
    version: '1.0.15',
    minAndroid: '8.0',
    sizeBytes: 0,
    url: '/api/apps/tv/download',
    updateNote: 'pagamento por cartão de crédito e débito, além do Pix',
    platforms: ['Android TV', 'Google TV', 'TV Box'],
  },
}

const mb = (bytes: number) =>
  bytes > 0 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : null

export function DownloadPage() {
  const [env] = useState(() => {
    const detected = detectAppEnv()
    rememberAppEnv(detected)
    return detected
  })
  const [info, setInfo] = useState<AppInfo>(FALLBACK)
  const [iosSteps, setIosSteps] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/apps', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AppInfo | null) => {
        if (alive && d?.android) setInfo(d)
      })
      .catch(() => {
        /* mantém o fallback: o link direto do APK é estável */
      })
    return () => {
      alive = false
    }
  }, [])

  // Quem já está dentro do app não precisa baixar o app de novo.
  const inApp = env === 'app-android' || env === 'app-ios'

  return (
    <div className="page" style={{ paddingTop: 32, maxWidth: 900 }}>
      <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.2rem)', marginBottom: 8 }}>
        Baixar o MovieFlix
      </h1>
      <p className="muted" style={{ marginBottom: 28, fontSize: '0.92rem' }}>
        O mesmo MovieFlix do site, em um aplicativo de verdade — tela cheia, sem barra de
        navegador.
      </p>

      {!inApp && (
        <>
          <div className="panel">
            <div className="row-between">
              <div>
                <div className="panel-title">📱 MovieFlix para Android</div>
                <p className="panel-sub" style={{ marginBottom: 6 }}>
                  Aplicativo completo, com login, catálogo, favoritos, histórico e player.
                  Tudo o que aparece no site aparece no app.
                </p>
                <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                  Android {info.android.minAndroid} ou superior · versão {info.android.version}
                  {mb(info.android.sizeBytes) ? ` · ${mb(info.android.sizeBytes)}` : ''}
                </p>
              </div>
              <span className="badge badge--outline">
                {info.android.available ? 'Disponível' : 'Publicando'}
              </span>
            </div>

            <div className="inline" style={{ marginTop: 14 }}>
              <a
                className="btn btn--primary"
                href={info.android.url}
                download="movieflix-android.apk"
                type="application/vnd.android.package-archive"
              >
                <DownloadIcon size={17} /> Baixar para Android
              </a>
            </div>
            <p className="muted" style={{ marginBottom: 0, marginTop: 10, fontSize: '0.78rem' }}>
              Ao abrir o arquivo, o Android pede para permitir a instalação desta fonte. É o
              MovieFlix — o aplicativo não está na Play Store.
            </p>
          </div>

          <div className="panel">
            <div className="row-between">
              <div>
                <div className="panel-title">🍎 MovieFlix para iPhone</div>
                <p className="panel-sub" style={{ marginBottom: 6 }}>
                  Instalação pela tela de início do Safari, em tela cheia — sem barra de endereço
                  e sem abrir no navegador depois de instalado.
                </p>
                <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                  iOS {info.ios.minIos} ou superior (Safari)
                </p>
              </div>
              <span className="badge badge--outline">Disponível</span>
            </div>

            <div className="inline" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={() => setIosSteps((v) => !v)}>
                Instalar no iPhone
              </button>
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                3 toques, sem computador
              </span>
            </div>

            {iosSteps && (
              <div className="alert alert--info" style={{ marginTop: 14, marginBottom: 0 }}>
                <InfoIcon size={18} />
                <span>
                  Abra o MovieFlix no <strong>Safari</strong> do iPhone → toque em{' '}
                  <strong>Compartilhar</strong> (o quadrado com a seta) →{' '}
                  <strong>Adicionar à Tela de Início</strong> → <strong>Adicionar</strong>. O ícone
                  do MovieFlix fica na tela do iPhone e abre em tela cheia, sem endereço e sem
                  barra do Safari.
                </span>
              </div>
            )}

            <p className="muted" style={{ marginBottom: 0, marginTop: 12, fontSize: '0.78rem' }}>
              A Apple só distribui apps fora da App Store via conta de desenvolvedor paga. Por
              isso o iPhone usa a instalação pelo Safari: é a mesma página, o mesmo conteúdo e a
              mesma sensação de app, sem depender da loja.
            </p>
          </div>

          {/*
            APP DE TV — PRONTO.

            O selo "Em desenvolvimento" e o quadro de aviso foram removidos a
            pedido do proprietário: o app está publicado e não deve mais ser
            apresentado como beta. O botão vermelho "Baixar para TV" continua
            apontando para /api/apps/tv/download, que entrega o APK 1.0.7.
          */}
          {info.tv && (
            <div className="panel">
              <div className="row-between">
                <div>
                  <div className="panel-title">📺 MovieFlix para TV</div>
                  <p className="panel-sub" style={{ marginBottom: 6 }}>
                    Para Android TV, Google TV e TV Box. Funciona inteiro pelo controle remoto:
                    navegar, pausar, avançar, retroceder e tela cheia.
                  </p>
                  <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                    {(info.tv.platforms ?? ['Android TV', 'Google TV', 'TV Box']).join(' · ')} ·
                    versão {info.tv.version}
                    {mb(info.tv.sizeBytes) ? ` · ${mb(info.tv.sizeBytes)}` : ''}
                  </p>
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.82rem' }}>
                    Atualização: pagamento por cartão de crédito e débito, além do Pix.
                  </p>
                </div>
              </div>

              <div className="inline" style={{ marginTop: 14 }}>
                <a
                  className="btn btn--primary"
                  href={info.tv.url}
                  download="movieflix-tv.apk"
                  type="application/vnd.android.package-archive"
                >
                  <DownloadIcon size={17} /> Baixar para TV
                </a>
                <span className="muted" style={{ fontSize: '0.82rem' }}>
                  Instale pelo pendrive ou pelo navegador da TV
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {inApp && (
        <div className="panel">
          <div className="panel-title">Você já está no aplicativo</div>
          <p className="panel-sub" style={{ marginBottom: 0 }}>
            Este é o MovieFlix instalado. Não precisa baixar nada de novo — o aplicativo abre
            sempre a versão mais recente do site.
          </p>
        </div>
      )}

      <div className="panel">
        <div className="panel-title">🌐 Continuar no navegador</div>
        <p className="panel-sub" style={{ marginBottom: 0 }}>
          O MovieFlix também funciona direto no navegador do computador e do celular,
          sem instalar nada.
        </p>
      </div>
    </div>
  )
}
