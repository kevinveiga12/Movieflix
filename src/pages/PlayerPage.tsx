import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import Hls from 'hls.js'
import { loadCatalog, getById } from '../lib/catalog'
import { nextEpisode, formatTime, type PlaybackSource } from '../lib/player'
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
  VolumeIcon,
  FullscreenIcon,
  ArrowLeft,
  NextEpisodeIcon,
  SubtitlesIcon,
} from '../components/Icons'

const SAVE_INTERVAL = 10_000

export function PlayerPage() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { saveProgress, progressFor } = useHistory()

  // Tipo pedido na URL. `null` = não veio; nesse caso descobrimos pelo
  // catálogo, para que /assistir/1621 (uma SÉRIE) não seja tratado como filme.
  const askedType = params.get('type') as 'movie' | 'tv' | null
  const season = Number(params.get('season') ?? 1)
  const episode = Number(params.get('episode') ?? 1)

  const [ready, setReady] = useState(false)
  const [source, setSource] = useState<PlaybackSource | null>(null)
  const [notFound, setNotFound] = useState(false)
  // Resultado da autorização do SERVIDOR. null = ainda verificando.
  const [auth, setAuth] = useState<PlaybackAuth | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  // Incrementar força uma nova checagem (botão "Verificar novamente").
  const [authAttempt, setAuthAttempt] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const lastSave = useRef(0)

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [showUi, setShowUi] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subsOn, setSubsOn] = useState(false)

  /**
   * Tipo efetivo do título.
   *
   * A URL manda quando traz `?type=`, mas quando o parâmetro falta usamos o
   * tipo REAL do catálogo. Sem isso, abrir `/assistir/1621` (Boardwalk Empire,
   * uma série de 5 temporadas) pedia autorização como FILME: o servidor não
   * achava fonte, devolvia `no_source` e o cliente via "sem fonte de
   * reprodução" — exatamente o sintoma relatado no título 1621.
   */
  const catalogHit = useMemo(
    () => (ready ? getById(id ?? '') : undefined),
    [ready, id, authAttempt],
  )
  const type: 'movie' | 'tv' =
    askedType === 'movie' || askedType === 'tv' ? askedType : (catalogHit?.type ?? 'movie')

  // Título em exibição. Prefere o catálogo estático (metadados completos) e cai
  // para o título da resposta autorizada quando o item só existe no banco.
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

  // ── GATE REAL DE REPRODUÇÃO ─────────────────────────────────────────
  // O navegador não decide nada. Envia o token e o título; o servidor valida
  // conta, assinatura, validade e plano exigido, e só então devolve a URL.
  // Sem resposta autorizada, não existe fonte para tocar.
  useEffect(() => {
    if (!ready || !id) return
    let cancelled = false

    setAuthChecking(true)
    setAuth(null)
    setSource(null)
    setError(null)
    setNotFound(false)

    authorizePlayback({
      tmdbId: id,
      season: type === 'tv' ? season : undefined,
      episode: type === 'tv' ? episode : undefined,
    }).then((result) => {
      if (cancelled) return
      setAuth(result)
      setAuthChecking(false)

      if (result.allowed && result.source) {
        setSource({
          mode: result.source.mode,
          url: result.source.url,
          label: result.source.label ?? undefined,
        })
        setLoading(true)
      } else {
        setLoading(false)
        if (result.reason === 'not_in_catalog') setNotFound(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [ready, id, type, season, episode, authAttempt])

  // Inicializa o <video> para fontes diretas
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
            setError('Não foi possível carregar o vídeo. Tente novamente mais tarde.')
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

    // Retoma de onde parou
    const saved = progressFor(String(title?.tmdb_id ?? ''))
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

  // Salva progresso periodicamente
  useEffect(() => {
    if (!user || !title || source?.mode !== 'direct') return
    const id = setInterval(() => {
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
    return () => clearInterval(id)
  }, [user, title, source, type, season, episode, saveProgress])

  // Salva ao sair
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

  /**
   * Mantém o usuário dentro do MovieFlix quando o provedor tenta assumir a
   * frente.
   *
   * Por que isto existe: liberamos `allow-popups` no iframe porque sem essa
   * permissão o provedor recusa a reprodução. Com ela, o provedor pode abrir
   * uma aba. O que ele NÃO pode é tirar o cliente daqui — e é isto que garante:
   *
   *   - `window.blur`  → a janela perdeu o foco para algo que o provedor abriu.
   *   - `window.focus()` no mesmo tick → o MovieFlix volta a ficar na frente.
   *
   * Verificado em navegador real: o `blur` dispara e o `focus()` devolve a
   * janela. Como isso roda no mesmo instante, o cliente não chega a ver a outra
   * página — no pior caso vê um piscar. Não é o sandbox que fecha a aba (isso é
   * impossível para uma janela aberta por script de terceiros), é a nossa janela
   * voltando para a frente imediatamente.
   *
   * Não escondemos nada do usuário nem fingimos sucesso: se o vídeo não tocar,
   * o player mostra o erro dele como sempre.
   */
  useEffect(() => {
    function reclaim() {
      // `focus()` é barato e idempotente; chamar sempre evita depender de
      // heurística sobre quem roubou o foco.
      try {
        window.focus()
      } catch {
        /* alguns navegadores recusam sem gesto do usuário — sem problema */
      }
    }
    window.addEventListener('blur', reclaim)
    // Cobrir também a troca de aba pelo próprio navegador durante o player.
    document.addEventListener('visibilitychange', reclaim)
    return () => {
      window.removeEventListener('blur', reclaim)
      document.removeEventListener('visibilitychange', reclaim)
    }
  }, [])

  // Auto-hide da UI
  useEffect(() => {
    if (!showUi) return
    const id = setTimeout(() => setShowUi(false), 4000)
    return () => clearTimeout(id)
  }, [showUi, current, playing])

  // Atalhos de teclado
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const v = videoRef.current
      if (e.key === 'Escape') {
        navigate(-1)
        return
      }
      if (!v) return
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          void togglePlay()
          break
        case 'ArrowRight':
          e.preventDefault()
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 10)
          setShowUi(true)
          break
        case 'ArrowLeft':
          e.preventDefault()
          v.currentTime = Math.max(0, v.currentTime - 10)
          setShowUi(true)
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolume((x) => Math.min(1, x + 0.1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolume((x) => Math.max(0, x - 0.1))
          break
        case 'm':
          setMuted((m) => !m)
          break
        case 'f':
          void toggleFullscreen()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (v) {
      v.volume = volume
      v.muted = muted
    }
  }, [volume, muted])

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

  async function toggleFullscreen() {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) await document.exitFullscreen()
    else await el.requestFullscreen().catch(() => {})
  }

  function seekTo(ratio: number) {
    const v = videoRef.current
    if (!v || !v.duration) return
    v.currentTime = Math.max(0, Math.min(v.duration, ratio * v.duration))
  }

  const next = title && type === 'tv' ? nextEpisode(title, season, episode) : null
  const pct = duration ? (current / duration) * 100 : 0
  const bufPct = duration ? (buffered / duration) * 100 : 0

  // Verificando autorização — ainda não há decisão para mostrar.
  if (authChecking) {
    return (
      <div className="player-page">
        <div className="player-spinner" />
      </div>
    )
  }

  // Negado: mostra o motivo e a saída (criar conta, assinar, ver planos).
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
    <div className="player-page" ref={wrapRef}>
      <div
        className="player-stage"
        onMouseMove={() => setShowUi(true)}
        onClick={() => {
          if (source?.mode === 'direct') {
            setShowUi(true)
            void togglePlay()
          }
        }}
      >
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
                navigate(`/assistir/${title?.tmdb_id}?type=tv&season=${next.season}&episode=${next.episode}`)
              }
            }}
            onError={() => {
              setError('Não foi possível reproduzir este vídeo.')
              setLoading(false)
            }}
          >
            {subsOn && <track kind="subtitles" srcLang="pt" label="Português" default />}
          </video>
        )}

        {source?.mode === 'embed' && (
          /*
            Player em página inteira, sem aviso e sem rodapé.

            SANDBOX — o que está liberado e o que não está:

              allow-scripts        o player precisa rodar
              allow-same-origin    o player precisa acessar o próprio storage
              allow-presentation   tela cheia / cast
              allow-forms          login do provedor, quando houver

            `allow-popups` NÃO está liberado. Era ele que deixava o anúncio do
            provedor abrir aba nova (Shopee, lojas) no primeiro toque — o toque
            destinado ao play virava clique de anúncio. Sem essa permissão o
            navegador bloqueia a abertura e o toque continua sendo do player.

            `allow-top-navigation` também está ausente: o iframe não consegue
            trocar a página do MovieFlix.

            `referrerPolicy="origin"` é obrigatório: o provedor EmbedMovies só
            entrega o player quando recebe o Referer do site que o incorporou.
            Sem ele devolve uma página de cloaking em vez do vídeo.
          */
          <iframe
            src={source.url}
            title={title?.title ?? 'Player'}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
          />
        )}

        {loading && source?.mode === 'direct' && (
          <div className="player-center">
            <div className="player-spinner" />
          </div>
        )}

        {error && (
          <div className="player-error">
            <div className="player-error-card">
              <h3>Não foi possível reproduzir</h3>
              <p>{error}</p>
              <div className="inline" style={{ justifyContent: 'center' }}>
                <button className="btn btn--primary" onClick={() => window.location.reload()}>
                  Tentar novamente
                </button>
                <button className="btn btn--outline" onClick={() => navigate(-1)}>
                  Voltar
                </button>
              </div>
            </div>
          </div>
        )}

        <div className={`player-overlay ${showUi ? 'visible' : ''}`}>
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
            {source?.mode === 'direct' && (
              <button
                className="player-btn"
                onClick={() => setSubsOn((s) => !s)}
                aria-label="Legendas"
                title="Legendas"
                style={{ opacity: subsOn ? 1 : 0.6 }}
              >
                <SubtitlesIcon size={20} />
              </button>
            )}
          </div>

          <div className="player-bottom">
            {source?.mode === 'direct' && (
              <>
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
                  <button className="player-btn player-btn--main" onClick={togglePlay} aria-label={playing ? 'Pausar' : 'Reproduzir'}>
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

                  <div className="player-spacer" />

                  <button className="player-btn" onClick={() => setMuted((m) => !m)} aria-label="Mudo">
                    <VolumeIcon size={19} muted={muted || volume === 0} />
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      setVolume(Number(e.target.value))
                      setMuted(false)
                    }}
                    style={{ width: 90, accentColor: 'var(--mf-red)' }}
                    aria-label="Volume"
                  />

                  {next && (
                    <button
                      className="player-btn"
                      onClick={() =>
                        navigate(
                          `/assistir/${title?.tmdb_id}?type=tv&season=${next.season}&episode=${next.episode}`,
                        )
                      }
                      aria-label="Próximo episódio"
                      title="Próximo episódio"
                    >
                      <NextEpisodeIcon size={19} />
                    </button>
                  )}

                  <button className="player-btn" onClick={toggleFullscreen} aria-label="Tela cheia">
                    <FullscreenIcon size={19} />
                  </button>
                </div>
              </>
            )}

            {source?.mode === 'embed' && (
              <div className="inline" style={{ justifyContent: 'flex-end' }}>
                <div className="inline">
                  {next && (
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        navigate(
                          `/assistir/${title?.tmdb_id}?type=tv&season=${next.season}&episode=${next.episode}`,
                        )
                      }
                    >
                      <NextEpisodeIcon size={16} /> Próximo episódio
                    </button>
                  )}
                  <button className="btn btn--ghost btn--sm" onClick={toggleFullscreen}>
                    <FullscreenIcon size={16} /> Tela cheia
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
