import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Hero } from '../components/Hero'
import { CarouselRow } from '../components/CarouselRow'
import { PosterCard } from '../components/PosterCard'
import { loadCatalog, featured, rowsForHome, getById } from '../lib/catalog'
import { useAuth } from '../context/AuthContext'
import { useHistory, parseEpisodeId } from '../lib/userData'
import { PlayIcon } from '../components/Icons'

export function HomePage() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { user } = useAuth()
  const { continueWatching } = useHistory()

  useEffect(() => {
    let alive = true
    loadCatalog()
      .then(() => alive && setReady(true))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  const heroes = useMemo(() => (ready ? featured(5) : []), [ready])
  const rows = useMemo(() => (ready ? rowsForHome() : []), [ready])
  const resume = useMemo(() => {
    if (!ready || !user) return []
    return continueWatching()
      .map((h) => {
        const t = getById(String(h.tmdb_id), h.media_type)
        if (!t) return null
        const pct = h.duration_seconds ? h.position_seconds / h.duration_seconds : 0
        return { t, pct, h }
      })
      .filter(Boolean)
      .slice(0, 12) as Array<{ t: NonNullable<ReturnType<typeof getById>>; pct: number; h: any }>
  }, [ready, user, continueWatching])

  if (error) {
    return (
      <div className="page">
        <div className="empty">
          <h3>Não foi possível carregar o catálogo</h3>
          <p>{error}</p>
          <button className="btn btn--primary" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 'clamp(440px,62vh,720px)', marginBottom: 40 }} />
        <div className="grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <Hero items={heroes} />

      <div className="page">
        {resume.length > 0 && (
          <CarouselRow title="Continuar assistindo">
            {resume.map(({ t, pct, h }) => {
              const ep = parseEpisodeId(h.episode_id)
              return (
              <Link
                key={`${t.tmdb_id}-${h.episode_id ?? 'movie'}`}
                to={`/assistir/${t.tmdb_id}?type=${t.type}${
                  ep ? `&season=${ep.season}&episode=${ep.episode}` : ''
                }`}
                className="card card--wide"
              >
                <div className="card-poster">
                  <img src={t.backdrop_url || t.poster_url} alt={t.title} loading="lazy" />
                  <div className="card-play">
                    <span>
                      <PlayIcon size={20} />
                    </span>
                  </div>
                  <div className="card-progress">
                    <span style={{ width: `${Math.min(100, pct * 100)}%` }} />
                  </div>
                </div>
                <div className="card-info">
                  <div className="card-title">{t.title}</div>
                  <div className="card-sub">
                    {ep ? <span>T{ep.season} E{ep.episode}</span> : <span>Filme</span>}
                    <span>· {Math.round(pct * 100)}% assistido</span>
                  </div>
                </div>
              </Link>
              )
            })}
          </CarouselRow>
        )}

        {rows.map((row) => (
          <CarouselRow
            key={row.title}
            title={row.title}
            linkTo={
              row.title === 'Séries'
                ? '/series'
                : ['Lançamentos', 'Em alta', 'Aclamados pela crítica'].includes(row.title)
                  ? '/filmes'
                  : `/filmes?genero=${encodeURIComponent(row.title)}`
            }
          >
            {row.items.map((t) => (
              <PosterCard key={`${t.type}-${t.tmdb_id}`} title={t} />
            ))}
          </CarouselRow>
        ))}

        {!rows.length && (
          <div className="empty">
            <h3>Catálogo vazio</h3>
            <p>Nenhum título com fonte de reprodução disponível no momento.</p>
          </div>
        )}
      </div>
    </>
  )
}
