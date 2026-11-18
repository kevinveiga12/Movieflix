import { Link } from 'react-router-dom'
import type { PlaybackAuth } from '../lib/types'
import { InfoIcon, PlayIcon, ArrowLeft } from '../components/Icons'

/**
 * Bloqueio de reprodução.
 *
 * Mostrado quando /api/playback/authorize nega. Cada motivo tem uma saída
 * concreta — nunca um beco sem saída, e nunca um botão que finge funcionar.
 */
export function PlaybackGate({
  auth,
  titleName,
  onRetry,
  backTo,
}: {
  auth: PlaybackAuth
  titleName?: string
  onRetry?: () => void
  backTo?: string
}) {
  const reason = auth.reason

  const config: Record<string, { heading: string; body: string; cta?: { label: string; to: string } }> = {
    unauthenticated: {
      heading: 'Crie sua conta para assistir',
      body: 'Você pode navegar pelo catálogo livremente. A reprodução é liberada para quem tem conta — é grátis e leva menos de um minuto.',
      cta: { label: 'Criar conta grátis', to: '/cadastro' },
    },
    no_subscription: {
      heading: 'Entre na sua conta para assistir',
      body: 'O MovieFlix é gratuito: basta ter uma conta. Entre para liberar a reprodução.',
      cta: { label: 'Entrar', to: '/login' },
    },
    plan_too_low: {
      heading: 'Entre na sua conta para assistir',
      body: 'O MovieFlix é gratuito: basta ter uma conta. Entre para liberar a reprodução.',
      cta: { label: 'Entrar', to: '/login' },
    },
    no_source: {
      heading: 'Sem fonte de reprodução',
      body: 'Este título está no catálogo, mas ainda não tem uma fonte de vídeo autorizada cadastrada.',
    },
    not_in_catalog: {
      heading: 'Título não disponível para reprodução',
      body: 'Este conteúdo não está no catálogo administrado, então não há fonte de vídeo para ele.',
    },
    episode_not_found: {
      heading: 'Episódio indisponível',
      body: auth.message ?? 'Este episódio não está disponível.',
    },
  }

  const c = config[reason ?? ''] ?? {
    heading: 'Não foi possível liberar a reprodução',
    body: auth.message ?? 'Tente novamente em instantes.',
  }

  return (
    <div className="page" style={{ paddingTop: 48, maxWidth: 640 }}>
      <div className="panel" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>🔒</div>
        <h2 className="section-title" style={{ fontSize: '1.4rem', marginBottom: 10 }}>
          {c.heading}
        </h2>
        {titleName && (
          <p className="muted" style={{ marginBottom: 6, fontSize: '0.9rem' }}>
            {titleName}
          </p>
        )}
        <p className="panel-sub" style={{ marginBottom: 20 }}>
          {c.body}
        </p>

        <div className="inline" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          {c.cta && (
            <Link to={c.cta.to} className="btn btn--primary">
              <PlayIcon size={17} /> {c.cta.label}
            </Link>
          )}
          {reason === 'unauthenticated' && (
            <Link to="/login" className="btn btn--outline">
              Já tenho conta
            </Link>
          )}
          {onRetry && (
            <button className="btn btn--ghost" onClick={onRetry}>
              Verificar novamente
            </button>
          )}
          {backTo && (
            <Link to={backTo} className="btn btn--ghost">
              <ArrowLeft size={17} /> Voltar
            </Link>
          )}
        </div>

        {(reason === 'no_subscription' || reason === 'plan_too_low') && (
          <div className="alert alert--info" style={{ marginTop: 20, textAlign: 'left' }}>
            <InfoIcon size={18} />
            <span>
              O MovieFlix é <strong>gratuito</strong>. Não há plano para contratar — só é preciso
              estar logado.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
