import { Link } from 'react-router-dom'
import type { PlaybackAuth } from '../lib/types'
import { WHATSAPP_DISPLAY, whatsappUrl } from '../lib/access'
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
      body: 'Você pode navegar pelo catálogo livremente, mas a reprodução é liberada apenas para quem tem conta e plano ativo.',
      cta: { label: 'Criar conta grátis', to: '/cadastro' },
    },
    no_subscription: {
      heading: 'Escolha um plano para assistir',
      body: 'Sua conta ainda não tem um plano ativo. Escolha um plano e fale com a gente pelo WhatsApp para ativar.',
      cta: { label: 'Ver planos', to: '/planos' },
    },
    plan_too_low: {
      heading: 'Seu plano não cobre este título',
      body: auth.message ?? 'Este título exige um plano superior ao seu.',
      cta: { label: 'Ver planos', to: '/planos' },
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
              Ativação pelo WhatsApp <strong>{WHATSAPP_DISPLAY}</strong>.{' '}
              <a
                href={whatsappUrl('Olá! Quero ativar meu plano no MovieFlix.')}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'underline' }}
              >
                Abrir conversa
              </a>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
