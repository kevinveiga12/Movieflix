import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { loadCatalog, getById, relatedTo, backdropUrl, posterUrl } from '../lib/catalog'
import { PosterCard } from '../components/PosterCard'
import { CarouselRow } from '../components/CarouselRow'
import { useAuth } from '../context/AuthContext'
import { useFavorites, useHistory, parseEpisodeId } from '../lib/userData'
import { firstEpisode } from '../lib/player'
import { PlayIcon, HeartIcon, StarIcon, ArrowLeft, CheckIcon, InfoIcon } from '../components/Icons'
import type { MediaType } from '../lib/types'

export function TitleDetailPage() {
  const { type, id } = useParams<{ type: string; id: string }>()
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [season, setSeason] = useState(1)
  const { user } = useAuth()
  const { isFavorite, toggle } = useFavorites()
  const { progressFor } = useHistory()

  useEffect(() => {
    loadCatalog().then(() => setReady(true))
  }, [])

  const title = useMemo(
    () => (ready ? getById(id ?? '', type as MediaType) : undefined),
    [ready, id, type],
  )

  const related = useMemo(() => (title ? relatedTo(title) : []), [title])
  const progress = title ? progressFor(String(title.tmdb_id)) : null
  const fav = title ? isFavorite(String(title.tmdb_id)) : false

  if (!ready) {
    return (
      <div className="page" style={{ paddingTop: 40 }}>
        <div className="skeleton" style={{ height: 420, marginBottom: 24 }} />
      </div>
    )
  }

  if (!title) {
    return (
      <div className="page">
        <div className="empty">
          <h3>Título não encontrado</h3>
          <p>Este conteúdo não está no catálogo.</p>
          <Link to="/" className="btn btn--primary">
            Voltar ao início
          </Link>
        </div>
      </div>
    )
  }

  const isSeries = title.type === 'tv'
  const seasons = title.seasons ?? 1
  const episodesAvailable = title.episodes_available ?? []
  const rating = title.vote_average ? title.vote_average.toFixed(1) : null
  const playable = isSeries ? episodesAvailable.length > 0 : Boolean(title.video_url)

  function watchHref() {
    if (!title) return '/'
    if (isSeries) {
      const ep = firstEpisode(title)
      if (!ep) return `/titulo/${title.type}/${title.tmdb_id}`
      return `/assistir/${title.tmdb_id}?type=tv&season=${ep.season}&episode=${ep.episode}`
    }
    return `/assistir/${title.tmdb_id}?type=movie`
  }

  const resumeEp = progress ? parseEpisodeId(progress.episode_id) : null
  const resumeHref =
    progress && title
      ? `/assistir/${title.tmdb_id}?type=${title.type}${
          resumeEp ? `&season=${resumeEp.season}&episode=${resumeEp.episode}` : ''
        }`
      : null

  /**
   * Destino de "Assistir".
   *
   * Sem sessão vai DIRETO para o login, com o destino guardado em `state.from`
   * — o login devolve a pessoa ao título. Antes o link levava ao player, que
   * mostrava a tela do PlaybackGate ("crie sua conta") e exigia um segundo
   * clique. O proprietário pediu: redirecionar imediatamente, sem telas
   * intermediárias.
   */
  function watchTarget(href: string) {
    return user ? href : '/login'
  }
  function watchState(href: string) {
    return user ? undefined : { from: href }
  }

  const seasonEpisodes = episodesAvailable
    .filter((e) => Number(e.split('/')[0]) === season)
    .map((e) => Number(e.split('/')[1]))
    .sort((a, b) => a - b)

  return (
    <>
      <div className="detail-hero">
        <div className="detail-hero-bg">
          <img src={backdropUrl(title)} alt="" />
        </div>
        <div className="detail-body">
          <div className="detail-poster">
            <img src={posterUrl(title, 'w500')} alt={title.title} />
          </div>
          <div className="detail-info">
            <div className="hero-badges">
              {title.dublado_ptbr && <span className="badge badge--purple">Dublado (pt-BR)</span>}
              {title.quality && <span className="badge badge--glass">{title.quality}</span>}
              {title.category && <span className="badge badge--outline">{title.category}</span>}
            </div>
            <h1 className="detail-title display">{title.title}</h1>
            <div className="detail-meta">
              {rating && (
                <span style={{ color: 'var(--warning)', fontWeight: 700 }}>
                  <StarIcon size={13} /> {rating}
                </span>
              )}
              {title.year && <span>{title.year}</span>}
              {isSeries ? (
                <span>
                  {seasons} temporada(s) · {title.episodes ?? episodesAvailable.length} episódios
                </span>
              ) : title.duration ? (
                <span>{title.duration} min</span>
              ) : null}
              {title.language && <span>{title.language}</span>}
            </div>
            <p className="detail-desc">{title.description}</p>

            <div className="detail-actions">
              {playable ? (
                <>
                  <Link
                    to={watchTarget(resumeHref ?? watchHref())}
                    state={watchState(resumeHref ?? watchHref())}
                    className="btn btn--primary btn--lg"
                  >
                    <PlayIcon size={19} />
                    {resumeHref ? 'Continuar assistindo' : isSeries ? 'Assistir T1 E1' : 'Assistir'}
                  </Link>
                  {resumeHref && (
                    <Link
                      to={watchTarget(watchHref())}
                      state={watchState(watchHref())}
                      className="btn btn--ghost btn--lg"
                    >
                      <InfoIcon size={19} /> Do início
                    </Link>
                  )}
                </>
              ) : (
                <button className="btn btn--outline btn--lg" disabled>
                  Fonte de vídeo não configurada
                </button>
              )}

              <button
                className="btn btn--ghost btn--lg"
                onClick={async () => {
                  if (!user) {
                    navigate('/login')
                    return
                  }
                  await toggle(title)
                }}
                aria-pressed={fav}
              >
                {fav ? <CheckIcon size={19} /> : <HeartIcon size={19} filled={fav} />}
                {fav ? 'Nos favoritos' : 'Favoritar'}
              </button>
            </div>

            {!playable && (
              <p className="muted" style={{ marginTop: 16, fontSize: '0.85rem' }}>
                Este título está no catálogo, mas ainda não tem uma fonte de reprodução autorizada
                cadastrada.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="page">
        {isSeries && episodesAvailable.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Episódios</h2>
            </div>
            {seasons > 1 && (
              <div className="season-tabs">
                {Array.from({ length: seasons }).map((_, i) => (
                  <button
                    key={i}
                    className={`chip ${season === i + 1 ? 'active' : ''}`}
                    onClick={() => setSeason(i + 1)}
                  >
                    Temporada {i + 1}
                  </button>
                ))}
              </div>
            )}
            <div className="episode-list">
              {seasonEpisodes.length === 0 ? (
                <p className="muted">Nenhum episódio disponível nesta temporada.</p>
              ) : (
                seasonEpisodes.map((ep) => (
                  <Link
                    key={ep}
                    to={watchTarget(
                      `/assistir/${title.tmdb_id}?type=tv&season=${season}&episode=${ep}`,
                    )}
                    state={watchState(
                      `/assistir/${title.tmdb_id}?type=tv&season=${season}&episode=${ep}`,
                    )}
                    className="episode"
                  >
                    <span className="episode-num">{ep}</span>
                    <span className="episode-info">
                      <span className="episode-title">
                        T{season} E{ep} — {title.title}
                      </span>
                      <span className="episode-sub">Dublado (pt-BR) · {title.quality}</span>
                    </span>
                    <PlayIcon size={18} />
                  </Link>
                ))
              )}
            </div>
          </section>
        )}

        {related.length > 0 && (
          <CarouselRow title="Títulos relacionados">
            {related.map((t) => (
              <PosterCard key={`${t.type}-${t.tmdb_id}`} title={t} />
            ))}
          </CarouselRow>
        )}

        <div style={{ marginTop: 24 }}>
          <button className="btn btn--outline" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} /> Voltar
          </button>
        </div>
      </div>
    </>
  )
}
