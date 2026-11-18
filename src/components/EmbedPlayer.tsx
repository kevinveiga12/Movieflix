import { useEffect, useRef, useState } from 'react'
import { PlayIcon, InfoIcon } from './Icons'
import { EMBED_SANDBOX, EMBED_ALLOW } from '../lib/player'

/**
 * Reprodução por provedor externo.
 *
 * Substitui o antigo aviso "Fonte externa — ..." (que expunha nome de
 * provedor e instruções para o administrador na tela do cliente) por uma
 * experiência limpa e por um estado real de indisponibilidade.
 *
 * Regras que o componente garante:
 *  - o iframe NUNCA recebe `allow-popups` nem `allow-top-navigation`; logo,
 *    nenhum provedor consegue abrir aba nova ou trocar a página do MovieFlix;
 *  - se o player do provedor não entregar um vídeo em `WAIT_MS`, a UI assume
 *    que ele não carregou e mostra a mensagem curta em português;
 *  - nada de jargão: o cliente não vê "embed", "iframe", "provedor" nem o
 *    domínio da fonte externa.
 *
 * Detecção de falha: como o iframe é de outra origem, não é possível ler o
 * DOM dele. O sinal disponível é o evento `load` — quando o provedor entrega
 * o player, ele carrega rápido; quando entrega desafio anti-bot ou recusa a
 * incorporação, o evento não chega dentro da janela de espera. Também é
 * possível o `load` chegar e o vídeo mesmo assim não tocar (caso do desafio
 * anti-bot que renderiza na própria página), por isso a checagem é dupla:
 * `load` + um período de tolerância.
 */

const WAIT_MS = 12_000

export function EmbedPlayer({
  url,
  title,
  onRetry,
}: {
  url: string
  title?: string
  onRetry?: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setState('loading')
    const loaded = { current: false }

    const onLoad = () => {
      loaded.current = true
      // `load` chegou: o player foi entregue. Ele ainda pode estar montando o
      // <video>, então damos um instante antes de considerar pronto.
      window.setTimeout(() => {
        setState((s) => (s === 'loading' ? 'ready' : s))
      }, 2500)
    }

    const frame = frameRef.current
    frame?.addEventListener('load', onLoad)

    // Se nada carregar na janela de espera, o provedor não serve para
    // incorporação. Não ficamos em spinner eterno.
    const timer = window.setTimeout(() => {
      if (!loaded.current) setState((s) => (s === 'loading' ? 'failed' : s))
    }, WAIT_MS)

    return () => {
      frame?.removeEventListener('load', onLoad)
      window.clearTimeout(timer)
    }
  }, [url, attempt])

  function retry() {
    setAttempt((n) => n + 1)
    onRetry?.()
  }

  if (state === 'failed') {
    return (
      <div className="player-unavailable" role="status">
        <div className="player-unavailable__icon">
          <InfoIcon size={26} />
        </div>
        <h3 className="player-unavailable__title">Conteúdo indisponível agora</h3>
        <p className="player-unavailable__text">
          Não conseguimos iniciar este título no momento. Tente novamente em
          instantes — o restante do catálogo continua funcionando normalmente.
        </p>
        <div className="player-unavailable__actions">
          <button className="btn btn--primary" onClick={retry}>
            <PlayIcon size={17} /> Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <iframe
        key={attempt}
        ref={frameRef}
        src={url}
        title={title ?? 'Player'}
        allow={EMBED_ALLOW}
        allowFullScreen
        referrerPolicy="origin"
        sandbox={EMBED_SANDBOX}
        style={{ width: '100%', height: '100%', border: 0 }}
      />
      {state === 'loading' && (
        <div className="player-center">
          <div className="player-spinner" />
        </div>
      )}
    </>
  )
}
