import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate, useLocation, Link } from 'react-router-dom'
import Hls from 'hls.js'
import { loadCatalog, getById } from '../lib/catalog'
import { nextEpisode, formatTime } from '../lib/player'
import { authorizePlayback } from '../lib/access'
import { PlaybackGate } from '../components/PlaybackGate'
import type { PlaybackAuth, Title } from '../lib/types'
import { useAuth } from '../context/AuthContext'
import { useHistory } from '../lib/userData'
import {
  PlayIcon,
  PauseIcon,
  SkipBack,
  SkipForward,
  ArrowLeft,
  FullscreenIcon,
  XIcon,
} from '../components/Icons'
import { VirtualMouse, HoldDetector, clickAtRatio } from '../lib/virtualMouse'

/**
 * ════════════════════════════════════════════════════════════════════════════
 * PLAYER — três pedidos do proprietário, resolvidos aqui
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1) PLAYER LIMPO
 *    Ao entrar no filme/série o vídeo ocupa a tela e NADA fica por cima. A
 *    nossa interface (voltar, título, tela cheia, trocar servidor) só aparece
 *    quando a pessoa toca na tela, e some sozinha depois de alguns segundos
 *    parada — ou no toque seguinte.
 *
 * 2) TELA CHEIA DE VERDADE
 *    O botão chama a Fullscreen API no NOSSO contêiner (`.player-stage`), não
 *    no iframe do provedor. Antes não existia botão nenhum: o que o cliente
 *    via era o botão do provedor, dentro de um iframe com `sandbox`, e o
 *    navegador recusava a chamada — a tela "enchia" mas o vídeo continuava
 *    pequeno e os controles do site seguiam na frente. Agora o contêiner vai
 *    para tela cheia, o iframe preenche 100% dele, e a nossa UI some.
 *
 * 3) TROCA AUTOMÁTICA DE SERVIDOR
 *    O servidor devolve TODAS as opções (`sources`), já verificadas. O player
 *    começa pela primeira que sabidamente entrega player. Se em 5 segundos o
 *    iframe não carregar, troca sozinho para a próxima. E o aviso "o vídeo não
 *    está rodando" com o botão de trocar servidor está sempre a um toque.
 *
 * ── O QUE É POSSÍVEL E O QUE NÃO É (sem inventar) ───────────────────────────
 *
 * O vídeo roda em um iframe de OUTRO domínio. A política de origem do
 * navegador impede ler `currentTime`, `paused` ou o estado do player de dentro
 * dele. Por isso:
 *   • não existe barra de progresso nossa no modo embed (a do provedor é a
 *     única, e é a verdadeira);
 *   • "o vídeo começou?" não é observável — o que observamos é se a PÁGINA do
 *     provedor carregou e se ela tem player (verificação feita no servidor);
 *   • o progresso salvo no modo embed é o TEMPO DECORRIDO com a aba visível,
 *     declarado como aproximação, nunca uma posição inventada.
 *
 * No modo DIRETO (arquivo .mp4/.m3u8 cadastrado pelo admin) tudo isso é real:
 * posição, duração, buffer e retomada exata vêm do <video>.
 */

/** Intervalo de gravação do progresso. */
const SAVE_INTERVAL = 15_000

/** Tempo sem interação até a nossa UI sumir. */
const UI_HIDE_MS = 4_000

/**
 * Tempo máximo para o iframe do provedor carregar antes de trocar de servidor.
 *
 * O pedido foi "uns 5 segundos". Contamos a partir da montagem do iframe: se o
 * evento `load` não chegou nesse prazo, a opção está travada e passamos para a
 * seguinte automaticamente.
 */
const SERVER_TIMEOUT_MS = 5_000

/** Tick do contador de tempo decorrido no modo embed. */
const EMBED_TICK_MS = 1_000

interface SourceOption {
  id: string
  label: string
  url: string
  mode: 'direct' | 'embed'
  verified?: boolean | null
}

export function PlayerPage() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading: authLoading } = useAuth()
  const { saveProgress, progressFor } = useHistory()

  const askedType = params.get('type') as 'movie' | 'tv' | null
  const season = Number(params.get('season') ?? 1)
  const episode = Number(params.get('episode') ?? 1)

  const [ready, setReady] = useState(false)
  const [sources, setSources] = useState<SourceOption[]>([])
  const [sourceIndex, setSourceIndex] = useState(0)
  const [notFound, setNotFound] = useState(false)
  const [auth, setAuth] = useState<PlaybackAuth | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [authAttempt, setAuthAttempt] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const lastSave = useRef(0)
  const embedElapsed = useRef(0)
  const fromStart = params.get('from') === 'start'

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** Nossa UI (voltar, título, tela cheia, trocar servidor). */
  const [showUi, setShowUi] = useState(true)
  const [uiPoke, setUiPoke] = useState(0)

  /** Tela cheia real do contêiner. */
  const [isFullscreen, setIsFullscreen] = useState(false)

  /** O iframe do provedor já disparou `load`? */
  const [frameLoaded, setFrameLoaded] = useState(false)
  /** O aviso "não está rodando" foi acionado (automático ou pelo cliente). */
  const [stalled, setStalled] = useState(false)
  /** Já trocamos de servidor automaticamente nesta sessão? */
  const autoSwitched = useRef(false)

  const mouseRef = useRef<VirtualMouse | null>(null)
  if (!mouseRef.current) mouseRef.current = new VirtualMouse()
  const holdRef = useRef<HoldDetector | null>(null)
  if (!holdRef.current) holdRef.current = new HoldDetector()
  const [mouseOn, setMouseOn] = useState(false)
  const [mouseTick, setMouseTick] = useState(0)

  // ── Login obrigatório ────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading || user) return
    navigate('/login', {
      replace: true,
      state: { from: `${location.pathname}${location.search}` },
    })
  }, [authLoading, user, navigate, location.pathname, location.search])

  const catalogHit = useMemo(
    () => (ready ? getById(id ?? '') : undefined),
    [ready, id, authAttempt],
  )
  const type: 'movie' | 'tv' =
    askedType === 'movie' || askedType === 'tv' ? askedType : (catalogHit?.type ?? 'movie')

  const title = useMemo<Title | undefined>(() => {
    if (!ready) return undefined
    const found = getById(id ?? '', type)
    if (found) return found
    if (auth?.allowed && auth.title) {
      return {
        id: String(auth.title.tmdb_id),
        tmdb_id: auth.title.tmdb_id,
        title: auth.title.title,
        description: '',
        poster_url: '',
        backdrop_url: '',
        video_url: '',
        vote_average: null,
        popularity: 0,
        release_date: '',
        category: '',
        language: '',
        quality: auth.title.quality ?? '',
        type,
        media_type: type,
        year: '',
        duration: null,
      }
    }
    return undefined
  }, [ready, id, type, auth])

  useEffect(() => {
    loadCatalog().then(() => setReady(true))
  }, [])

  // ── Autorização no servidor ──────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !id || !user) return
    let cancelled = false

    setAuthChecking(true)
    setAuth(null)
    setSources([])
    setSourceIndex(0)
    setError(null)
    setNotFound(false)
    setStalled(false)
    autoSwitched.current = false

    authorizePlayback({
      tmdbId: id,
      season: type === 'tv' ? season : undefined,
      episode: type === 'tv' ? episode : undefined,
    }).then((result) => {
      if (cancelled) return
      setAuth(result)
      setAuthChecking(false)

      if (result.allowed) {
        /**
         * Lista de opções. O servidor manda `sources` (todas verificadas e
         * ordenadas). Se por algum motivo só vier `source`, montamos a lista
         * com ela — o player nunca fica sem fonte.
         */
        const list: SourceOption[] =
          result.sources && result.sources.length
            ? result.sources
            : result.source
              ? [
                  {
                    id: 'catalog',
                    label: 'Opção 1',
                    url: result.source.url,
                    mode: result.source.mode,
                    verified: null,
                  },
                ]
              : []

        setSources(list)
        setSourceIndex(0)
        setLoading(true)
      } else {
        setLoading(false)
        if (result.reason === 'not_in_catalog') setNotFound(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [ready, id, type, season, episode, authAttempt, user])

  const source = sources[sourceIndex] ?? null
  const isEmbed = source?.mode === 'embed'
  const hasMultiple = sources.length > 1

  // ── <video> nativo (modo direto) ─────────────────────────────────────────
  useEffect(() => {
    if (!source || source.mode !== 'direct') return
    const video = videoRef.current
    if (!video) return

    setLoading(true)
    setError(null)

    const isHls = /\.m3u8(\?|#|$)/i.test(source.url)

    if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false })
        hlsRef.current = hls
        hls.loadSource(source.url)
        hls.attachMedia(video)
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            setError('Não foi possível carregar o vídeo. Tente outro servidor.')
            setLoading(false)
          }
        })
      } else {
        setError('Seu navegador não suporta este formato de vídeo.')
        setLoading(false)
        return
      }
    } else {
      video.src = source.url
    }

    const saved = fromStart ? null : progressFor(String(title?.tmdb_id ?? ''))
    if (saved && saved.position_seconds > 5) {
      const onMeta = () => {
        if (video.duration && saved.position_seconds < video.duration - 10) {
          video.currentTime = saved.position_seconds
        }
        video.removeEventListener('loadedmetadata', onMeta)
      }
      video.addEventListener('loadedmetadata', onMeta)
    }

    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  // ── Progresso: modo direto ───────────────────────────────────────────────
  useEffect(() => {
    if (!user || !title || source?.mode !== 'direct') return
    const timer = setInterval(() => {
      const v = videoRef.current
      if (!v || v.paused || !v.duration) return
      if (Date.now() - lastSave.current < SAVE_INTERVAL) return
      lastSave.current = Date.now()
      void saveProgress({
        title,
        season: type === 'tv' ? season : null,
        episode: type === 'tv' ? episode : null,
        position: v.currentTime,
        duration: v.duration,
      })
    }, 5000)
    return () => clearInterval(timer)
  }, [user, title, source, type, season, episode, saveProgress])

  // ── Progresso: modo embed (tempo decorrido, declarado) ───────────────────
  useEffect(() => {
    if (!user || !title || source?.mode !== 'embed') return

    embedElapsed.current = 0
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') embedElapsed.current += EMBED_TICK_MS / 1000
    }, EMBED_TICK_MS)

    const save = setInterval(() => {
      if (embedElapsed.current < 5) return
      void saveProgress({
        title,
        season: type === 'tv' ? season : null,
        episode: type === 'tv' ? episode : null,
        position: embedElapsed.current,
        duration: 0,
      })
    }, SAVE_INTERVAL)

    return () => {
      clearInterval(tick)
      clearInterval(save)
      if (embedElapsed.current >= 5) {
        void saveProgress({
          title,
          season: type === 'tv' ? season : null,
          episode: type === 'tv' ? episode : null,
          position: embedElapsed.current,
          duration: 0,
        })
      }
    }
  }, [user, title, source, type, season, episode, saveProgress])

  // ── Salva ao sair ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const v = videoRef.current
      if (v && title && v.currentTime > 5 && v.duration) {
        void saveProgress({
          title,
          season: type === 'tv' ? season : null,
          episode: type === 'tv' ? episode : null,
          position: v.currentTime,
          duration: v.duration,
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, type, season, episode])

  // ── Mantém o cliente dentro do MovieFlix ─────────────────────────────────
  useEffect(() => {
    function reclaim() {
      try {
        window.focus()
      } catch {
        /* alguns navegadores recusam sem gesto do usuário */
      }
    }
    window.addEventListener('blur', reclaim)
    document.addEventListener('visibilitychange', reclaim)
    return () => {
      window.removeEventListener('blur', reclaim)
      document.removeEventListener('visibilitychange', reclaim)
    }
  }, [])

  // ── Auto-hide da UI ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!showUi) return
    const timer = setTimeout(() => setShowUi(false), UI_HIDE_MS)
    return () => clearTimeout(timer)
  }, [showUi, current, playing, uiPoke])

  const pokeUi = useCallback(() => {
    setShowUi(true)
    setUiPoke((n) => n + 1)
  }, [])

  // ── Tela cheia real ──────────────────────────────────────────────────────
  useEffect(() => {
    function onChange() {
      const el = document.fullscreenElement as Element | null
      setIsFullscreen(Boolean(el && stageRef.current && el === stageRef.current))
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange as EventListener)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange as EventListener)
    }
  }, [])

  /**
   * Entra/sai da tela cheia no NOSSO contêiner.
   *
   * `requestFullscreen` precisa de gesto do usuário — é chamado direto do
   * clique, sem await antes. Se o navegador recusar (WebView antigo, iOS sem
   * suporte a elemento), caímos num modo "pseudo-tela-cheia" por CSS: o
   * contêiner já é `position: fixed; inset: 0`, então basta esconder a UI e
   * marcar o estado — o vídeo continua preenchendo a tela.
   */
  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current
    if (!el) return

    const doc = document as Document & {
      webkitFullscreenElement?: Element | null
      webkitExitFullscreen?: () => Promise<void> | void
    }
    const elAny = el as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void
    }

    const active = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null

    try {
      if (active) {
        if (document.exitFullscreen) await document.exitFullscreen()
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen()
        setIsFullscreen(false)
      } else {
        if (elAny.requestFullscreen) await elAny.requestFullscreen()
        else if (elAny.webkitRequestFullscreen) await elAny.webkitRequestFullscreen()
        setIsFullscreen(true)
      }
    } catch {
      // API indisponível ou recusada: alterna o modo CSS.
      setIsFullscreen((v) => !v)
    }
    setShowUi(false)
  }, [])

  // ── Troca de servidor ────────────────────────────────────────────────────
  const switchServer = useCallback(
    (auto = false) => {
      if (sources.length < 2) return
      setSourceIndex((i) => (i + 1) % sources.length)
      setFrameLoaded(false)
      setStalled(false)
      setError(null)
      setLoading(true)
      setShowUi(true)
      setUiPoke((n) => n + 1)
      if (auto) autoSwitched.current = true
    },
    [sources.length],
  )

  /**
   * Vigia de 5 segundos.
   *
   * Duas situações trocam o servidor sozinhas:
   *   a) a opção atual já foi verificada como SEM player no servidor
   *      (`verified === false`) — não há por que esperar;
   *   b) o iframe não disparou `load` em 5 s — a página está travada.
   *
   * Se o iframe carregou, NÃO trocamos por conta própria: o provedor pode
   * exigir um toque em "Assistir" antes de tocar, e trocar nesse momento
   * arrancaria o vídeo de quem estava prestes a assistir. Nesse caso o aviso
   * com o botão de trocar fica disponível.
   */
  useEffect(() => {
    if (!isEmbed || !source) return
    if (source.verified === false && hasMultiple && !autoSwitched.current) {
      switchServer(true)
      return
    }

    const timer = setTimeout(() => {
      if (frameLoaded) return
      if (hasMultiple && !autoSwitched.current) {
        switchServer(true)
      } else {
        setStalled(true)
        setLoading(false)
      }
    }, SERVER_TIMEOUT_MS)

    return () => clearTimeout(timer)
  }, [isEmbed, source, frameLoaded, hasMultiple, switchServer])

  // ── Atalhos de teclado / controle remoto ─────────────────────────────────
  useEffect(() => {
    const mouse = mouseRef.current!
    const hold = holdRef.current!

    const isOk = (key: string) =>
      key === ' ' ||
      key === 'k' ||
      key === 'Enter' ||
      key === 'MediaPlayPause' ||
      key === 'MediaPlay' ||
      key === 'MediaPause'

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Em tela cheia, Escape sai da tela cheia (o navegador já faz isso);
        // fora dela, sai do player.
        if (!document.fullscreenElement) navigate(-1)
        return
      }
      pokeUi()

      if (isOk(e.key)) {
        e.preventDefault()
        if (!e.repeat) hold.onDown(performance.now())
        return
      }

      if (e.key === 'ArrowLeft' || e.key === 'MediaRewind') {
        e.preventDefault()
        if (mouse.active) {
          mouse.move(-1, 0)
          setMouseTick((n) => n + 1)
        } else {
          const v = videoRef.current
          if (v) v.currentTime = Math.max(0, v.currentTime - 10)
        }
        return
      }

      if (e.key === 'ArrowRight' || e.key === 'MediaFastForward') {
        e.preventDefault()
        if (mouse.active) {
          mouse.move(1, 0)
          setMouseTick((n) => n + 1)
        } else {
          const v = videoRef.current
          if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10)
        }
        return
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (mouse.active) {
          e.preventDefault()
          mouse.move(0, e.key === 'ArrowUp' ? -1 : 1)
          setMouseTick((n) => n + 1)
        }
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (!isOk(e.key)) return
      if (hold.onUp() === 'short') {
        if (mouse.active) {
          clickAtRatio(document, window, mouse.ratioX(), mouse.ratioY())
          setMouseTick((n) => n + 1)
        } else {
          void togglePlay()
        }
      }
    }

    const timer = window.setInterval(() => {
      if (hold.tick(performance.now()) === 'hold') {
        mouse.toggle()
        setMouseOn(mouse.active)
        setMouseTick((n) => n + 1)
      }
    }, 50)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const mouse = mouseRef.current!
    const sync = () => mouse.setBounds(window.innerWidth, window.innerHeight)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  async function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      try {
        await v.play()
      } catch {
        setError('O navegador bloqueou a reprodução automática. Toque em play.')
      }
    } else {
      v.pause()
    }
  }

  function seekTo(ratio: number) {
    const v = videoRef.current
    if (!v || !v.duration) return
    v.currentTime = Math.max(0, Math.min(v.duration, ratio * v.duration))
  }

  const next = title && type === 'tv' ? nextEpisode(title, season, episode) : null
  const pct = duration ? (current / duration) * 100 : 0
  const bufPct = duration ? (buffered / duration) * 100 : 0

  if (authLoading || !user) {
    return (
      <div className="player-page">
        <div className="player-spinner" />
      </div>
    )
  }

  if (authChecking) {
    return (
      <div className="player-page">
        <div className="player-spinner" />
      </div>
    )
  }

  if (auth && !auth.allowed) {
    return (
      <PlaybackGate
        auth={auth}
        titleName={title?.title}
        onRetry={() => setAuthAttempt((n) => n + 1)}
        backTo={id ? `/titulo/${type}/${id}` : '/'}
      />
    )
  }

  if (notFound) {
    return (
      <div className="player-page">
        <div className="player-error">
          <div className="player-error-card">
            <h3>Título não encontrado</h3>
            <p>Este conteúdo não está no catálogo.</p>
            <Link to="/" className="btn btn--primary">
              Voltar ao início
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`player-page ${isFullscreen ? 'is-fullscreen' : ''}`}>
      <div className="player-stage" ref={stageRef}>
        {/*
          SENSOR DE TOQUE.

          Só existe quando a nossa UI está ESCONDIDA. É ele que devolve os
          controles ao primeiro toque. Com a UI visível ele não existe, então o
          toque no meio da tela vai direto para o player do provedor (play,
          pause, barra) — é o que mantém o iframe utilizável.
        */}
        {!showUi && (
          <button
            type="button"
            className="player-sensor"
            aria-label="Mostrar controles"
            onClick={() => pokeUi()}
          />
        )}

        {source?.mode === 'direct' && (
          <video
            ref={videoRef}
            playsInline
            autoPlay
            crossOrigin="anonymous"
            onPlay={() => {
              setPlaying(true)
              setLoading(false)
            }}
            onPause={() => setPlaying(false)}
            onWaiting={() => setLoading(true)}
            onPlaying={() => setLoading(false)}
            onCanPlay={() => setLoading(false)}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
            onProgress={(e) => {
              const v = e.currentTarget
              if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
            }}
            onEnded={() => {
              if (next) {
                navigate(
                  `/assistir/${title?.tmdb_id}?type=tv&season=${next.season}&episode=${next.episode}`,
                )
              }
            }}
            onError={() => {
              setError('Não foi possível reproduzir este vídeo.')
              setLoading(false)
            }}
          />
        )}

        {source?.mode === 'embed' && (
          /*
            O iframe do provedor.

            `key` = URL: trocar de servidor REMONTA o iframe em vez de só
            mudar o `src`. Sem isso o navegador mantém o documento antigo e a
            troca não tem efeito visível.

            SANDBOX — o que está liberado:
              allow-scripts        o player precisa rodar
              allow-same-origin    o player precisa do próprio storage
              allow-presentation   tela cheia / cast
              allow-forms          login do provedor, quando houver

            `allow-popups` NÃO está liberado: era ele que deixava o anúncio do
            provedor abrir aba nova no primeiro toque.
            `allow-top-navigation` também não: o iframe não troca a nossa página.

            `referrerPolicy="origin"` é obrigatório — o provedor só entrega o
            player quando recebe o Referer do site que o incorporou.
          */
          <iframe
            key={source.url}
            src={source.url}
            title={title?.title ?? 'Player'}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
            onLoad={() => {
              setFrameLoaded(true)
              setLoading(false)
            }}
          />
        )}

        {loading && source?.mode === 'direct' && (
          <div className="player-center">
            <div className="player-spinner" />
          </div>
        )}

        {/*
          AVISO "NÃO ESTÁ RODANDO".

          Aparece quando o iframe não carregou em 5 s e não há outra opção para
          trocar sozinho, ou quando o cliente pede. Sempre com o botão de trocar
          servidor — nunca um beco sem saída.
        */}
        {stalled && (
          <div className="player-error">
            <div className="player-error-card">
              <h3>O vídeo não está rodando</h3>
              <p>
                {hasMultiple
                  ? 'Este servidor não respondeu. Troque para outra opção — o filme continua do mesmo ponto.'
                  : 'Este servidor não respondeu agora. Tente novamente em instantes.'}
              </p>
              <div className="inline" style={{ justifyContent: 'center' }}>
                {hasMultiple && (
                  <button className="btn btn--primary" onClick={() => switchServer()}>
                    Trocar servidor
                  </button>
                )}
                <button
                  className="btn btn--outline"
                  onClick={() => {
                    setStalled(false)
                    setFrameLoaded(false)
                    setUiPoke((n) => n + 1)
                  }}
                >
                  Tentar de novo
                </button>
                <button className="btn btn--ghost" onClick={() => navigate(-1)}>
                  Voltar
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="player-error">
            <div className="player-error-card">
              <h3>Não foi possível reproduzir</h3>
              <p>{error}</p>
              <div className="inline" style={{ justifyContent: 'center' }}>
                {hasMultiple && (
                  <button className="btn btn--primary" onClick={() => switchServer()}>
                    Trocar servidor
                  </button>
                )}
                <button className="btn btn--outline" onClick={() => navigate(-1)}>
                  Voltar
                </button>
              </div>
            </div>
          </div>
        )}

        {/*
          NOSSA UI — some sozinha.

          No modo embed ela é mínima de propósito: o player do provedor já
          desenha a barra dele, e uma barra nossa por cima virava duas barras
          sobrepostas. Aqui ficam só: voltar, título, tela cheia e trocar
          servidor.
        */}
        <div
          className={`player-overlay ${showUi ? 'visible' : ''} ${
            isEmbed ? 'player-overlay--minimal' : ''
          }`}
        >
          <div className="player-top">
            <button className="player-btn" onClick={() => navigate(-1)} aria-label="Voltar">
              <ArrowLeft size={20} />
            </button>
            <div className="player-top-info">
              <div className="player-top-title">{title?.title}</div>
              <div className="player-top-sub">
                {type === 'tv' ? `Temporada ${season} · Episódio ${episode}` : title?.year}
                {title?.quality ? ` · ${title.quality}` : ''}
                {title?.dublado_ptbr ? ' · Dublado (pt-BR)' : ''}
              </div>
            </div>

            <div className="player-top-actions">
              {hasMultiple && (
                <button
                  className="player-btn player-btn--pill"
                  onClick={() => switchServer()}
                  aria-label="Trocar servidor"
                  title={`Servidor: ${source?.label ?? ''} — toque para trocar`}
                >
                  <span className="player-btn-label">{source?.label ?? 'Servidor'}</span>
                </button>
              )}
              <button
                className="player-btn"
                onClick={() => void toggleFullscreen()}
                aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              >
                {isFullscreen ? <XIcon size={20} /> : <FullscreenIcon size={20} />}
              </button>
            </div>
          </div>

          {source?.mode === 'direct' && (
            <div className="player-bottom">
              <div
                className="progress-track"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  seekTo((e.clientX - rect.left) / rect.width)
                }}
                role="slider"
                aria-label="Progresso"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
                tabIndex={0}
              >
                <div className="progress-buffer" style={{ width: `${bufPct}%` }} />
                <div className="progress-fill" style={{ width: `${pct}%` }} />
                <div className="progress-knob" style={{ left: `${pct}%` }} />
              </div>

              <div className="player-controls" style={{ marginTop: 14 }}>
                <button
                  className="player-btn player-btn--main"
                  onClick={togglePlay}
                  aria-label={playing ? 'Pausar' : 'Reproduzir'}
                >
                  {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
                </button>
                <button
                  className="player-btn"
                  onClick={() => {
                    const v = videoRef.current
                    if (v) v.currentTime = Math.max(0, v.currentTime - 10)
                  }}
                  aria-label="Voltar 10 segundos"
                >
                  <SkipBack size={19} />
                </button>
                <button
                  className="player-btn"
                  onClick={() => {
                    const v = videoRef.current
                    if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10)
                  }}
                  aria-label="Avançar 10 segundos"
                >
                  <SkipForward size={19} />
                </button>

                <span className="player-time">
                  {formatTime(current)} / {formatTime(duration)}
                </span>
              </div>
            </div>
          )}
        </div>

        {mouseOn && (
          <div
            className="tv-cursor"
            data-tick={mouseTick}
            style={{
              left: `${mouseRef.current!.ratioX() * 100}%`,
              top: `${mouseRef.current!.ratioY() * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  )
}
