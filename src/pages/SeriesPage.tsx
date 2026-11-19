import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { loadCatalog, getById, backdropUrl, posterUrl } from '../lib/catalog'
import { fetchSeriesEpisodes } from '../lib/access'
import { useAuth } from '../context/AuthContext'
import { PlayIcon, ArrowLeft, InfoIcon, StarIcon } from '../components/Icons'
import type { DbSeason, MediaType } from '../lib/types'

/**
 * Página de série com temporadas e episódios REAIS.
 *
 * Os episódios vêm de /api/db/series/:tmdbId/episodes, que lê `seasons` e
 * `episodes` do Supabase. Nada é inventado: se a série não tem temporadas
 * cadastradas, a página diz isso em vez de listar episódios fictícios.
 *
 * A reprodução continua passando por /api/playback/authorize — esta página só
 * monta o link; quem libera é o servidor.
 */
export function SeriesPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  /**
   * Destino de "Assistir".
   *
   * Sem sessão vai DIRETO ao login, com o destino em `state.from` — o login
   * devolve a pessoa ao episódio. Antes o link levava ao player, que mostrava
   * a tela do PlaybackGate e exigia um segundo clique. O proprietário pediu:
   * redirecionar imediatamente, sem telas intermediárias.
   */
  function watchTarget(href: string) {
    return user ? href : '/login'
  }
  function watchState(href: string) {
    return user ? undefined : { from: href }
  }

  const [ready, setReady] = useState(false)
  const [seasons, setSeasons] = useState<DbSeason[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(true)
  const [episodeError, setEpisodeError] = useState<string | null>(null)
  const [activeSeason, setActiveSeason] = useState<number | null>(null)

  useEffect(() => {
    loadCatalog().then(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoadingEpisodes(true)
    setEpisodeError(null)

    fetchSeriesEpisodes(id)
      .then((data) => {
        if (cancelled) return
        setSeasons(data.seasons ?? [])
        if (data.seasons?.length) setActiveSeason(data.seasons[0].season_number)
      })
      .catch((e) => {
        if (!cancelled) setEpisodeError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoadingEpisodes(false)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  const title = ready ? getById(id ?? '', 'tv' as MediaType) : undefined

  if (!ready) {
    return (
      <div className="page" style={{ paddingTop: 40 }}>
        <div className="skeleton" style={{ height: 420 }} />
      </div>
    )
  }

  if (!title) {
    return (
      <div className="page">
        <div className="empty">
          <h3>Série não encontrada</h3>
          <p>Este conteúdo não está no catálogo.</p>
          <Link to="/series" className="btn btn--primary">
            Ver séries
          </Link>
        </div>
      </div>
    )
  }

  const season = seasons.find((s) => s.season_number === activeSeason) ?? seasons[0]
  const totalEpisodes = seasons.reduce((n, s) => n + s.episodes.length, 0)

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
              {title.vote_average ? (
                <span style={{ color: 'var(--warning)', fontWeight: 700 }}>
                  <StarIcon size={13} /> {title.vote_average.toFixed(1)}
                </span>
              ) : null}
              {title.year && <span>{title.year}</span>}
              {seasons.length > 0 && (
                <span>
                  {seasons.length} temporada(s) · {totalEpisodes} episódio(s) disponíveis
                </span>
              )}
            </div>
            <p className="detail-desc">{title.description}</p>

            <div className="detail-actions">
              {season?.episodes.length ? (
                <Link
                  to={watchTarget(`/assistir/${title.tmdb_id}?type=tv&season=${season.season_number}&episode=${season.episodes[0].episode_number}`)}
                  state={watchState(`/assistir/${title.tmdb_id}?type=tv&season=${season.season_number}&episode=${season.episodes[0].episode_number}`)}
                  className="btn btn--primary btn--lg"
                >
                  <PlayIcon size={19} /> Assistir T{season.season_number} E
                  {season.episodes[0].episode_number}
                </Link>
              ) : (
                <button className="btn btn--outline btn--lg" disabled>
                  Sem episódios cadastrados
                </button>
              )}
              {!user && (
                <Link to="/cadastro" className="btn btn--ghost btn--lg">
                  Criar conta para assistir
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="page">
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Episódios</h2>
          </div>

          {loadingEpisodes && <div className="skeleton" style={{ height: 120 }} />}

          {!loadingEpisodes && episodeError && (
            <div className="alert alert--error">
              <InfoIcon size={18} />
              <span>{episodeError}</span>
            </div>
          )}

          {!loadingEpisodes && !episodeError && seasons.length === 0 && (
            <div className="alert alert--info">
              <InfoIcon size={18} />
              <span>
                Esta série está no catálogo, mas ainda não tem temporadas e episódios cadastrados no
                painel. Nada é exibido aqui para não mostrar episódios que não existem.
              </span>
            </div>
          )}

          {seasons.length > 1 && (
            <div className="season-tabs">
              {seasons.map((s) => (
                <button
                  key={s.id}
                  className={`chip ${activeSeason === s.season_number ? 'active' : ''}`}
                  onClick={() => setActiveSeason(s.season_number)}
                >
                  Temporada {s.season_number}
                </button>
              ))}
            </div>
          )}

          {season && season.episodes.length > 0 && (
            <div className="episode-list">
              {season.episodes.map((ep) => (
                <Link
                  key={ep.id}
                  to={watchTarget(`/assistir/${title.tmdb_id}?type=tv&season=${season.season_number}&episode=${ep.episode_number}`)}
                  state={watchState(`/assistir/${title.tmdb_id}?type=tv&season=${season.season_number}&episode=${ep.episode_number}`)}
                  className="episode"
                >
                  <span className="episode-num">{ep.episode_number}</span>
                  <span className="episode-info">
                    <span className="episode-title">
                      {ep.title || `Episódio ${ep.episode_number}`}
                    </span>
                    <span className="episode-sub">
                      T{season.season_number} E{ep.episode_number}
                      {ep.duration_seconds ? ` · ${Math.round(ep.duration_seconds / 60)} min` : ''}
                      {ep.video_url ? ' · disponível' : ' · sem fonte'}
                    </span>
                  </span>
                  <PlayIcon size={18} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <div style={{ marginTop: 24 }}>
          <button className="btn btn--outline" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} /> Voltar
          </button>
        </div>
      </div>
    </>
  )
}
