import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import Hls from 'hls.js'
import { loadCatalog, getById } from '../lib/catalog'
import { movieSource, episodeSource, nextEpisode, formatTime, type PlaybackSource } from '../lib/player'
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

  const type = (params.get('type') as 'movie' | 'tv') ?? 'movie'
  const season = Number(params.get('season') ?? 1)
  const episode = Number(params.get('episode') ?? 1)

  const [ready, setReady] = useState(false)
  const [source, setSource] = useState<PlaybackSource | null>(null)
  const [notFound, setNotFound] = useState(false)

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

  const title = useMemo(() => (ready ? getById(id ?? '', type) : undefined), [ready, id, type])

  useEffect(() => {
    loadCatalog().then(() => setReady(true))
  }, [])

  // Resolve a fonte de reprodução
  useEffect(() => {
    if (!ready) return
    if (!title) {
      setNotFound(true)
      return
    }
    const src = type === 'tv' ? episodeSource(title, season, episode) : movieSource(title)
    if (!src) {
      setError(
        type === 'tv'
          ? 'Este episódio não está disponível.'
          : 'Este título ainda não tem fonte de reprodução configurada.',
      )
      setLoading(false)
      return
    }
    setSource(src)
  }, [ready, title, type, season, episode])

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
          <iframe
            src={source.url}
            title={title?.title ?? 'Player'}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-popups"
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
              <div className="inline" style={{ justifyContent: 'space-between' }}>
                <span className="player-time">
                  Reprodução pelo provedor · use os controles do player
                </span>
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
