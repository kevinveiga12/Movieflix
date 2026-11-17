import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Title } from '../lib/types'
import { backdropUrl } from '../lib/catalog'
import { PlayIcon, InfoIcon, StarIcon } from './Icons'

interface Props {
  items: Title[]
}

export function Hero({ items }: Props) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (items.length <= 1) return
    const id = setInterval(() => setIndex((i) => (i + 1) % items.length), 9000)
    return () => clearInterval(id)
  }, [items.length])

  if (!items.length) return null
  const t = items[Math.min(index, items.length - 1)]
  const rating = t.vote_average ? t.vote_average.toFixed(1) : null

  return (
    <section className="hero">
      <div className="hero-bg" key={t.tmdb_id}>
        <img src={backdropUrl(t)} alt="" fetchPriority="high" />
      </div>

      <div className="hero-content">
        <div className="hero-badges">
          <span className="badge badge--red">Destaque</span>
          {t.quality && <span className="badge badge--glass">{t.quality}</span>}
          {t.dublado_ptbr && <span className="badge badge--purple">Dublado (pt-BR)</span>}
          {t.category && <span className="badge badge--outline">{t.category}</span>}
        </div>

        <h1 className="hero-title display">{t.title}</h1>

        <div className="hero-meta">
          {rating && (
            <span className="rating">
              <StarIcon size={13} /> {rating}
            </span>
          )}
          {t.year && <span>{t.year}</span>}
          {t.type === 'tv' && t.seasons ? <span>{t.seasons} temporada(s)</span> : null}
          {t.duration ? <span>{t.duration} min</span> : null}
        </div>

        <p className="hero-desc">{t.description}</p>

        <div className="hero-actions">
          <Link to={`/assistir/${t.tmdb_id}?type=${t.type}`} className="btn btn--primary btn--lg">
            <PlayIcon size={19} /> Assistir agora
          </Link>
          <Link to={`/titulo/${t.type}/${t.tmdb_id}`} className="btn btn--ghost btn--lg">
            <InfoIcon size={19} /> Mais informações
          </Link>
        </div>
      </div>

      {items.length > 1 && (
        <div className="hero-dots">
          {items.map((it, i) => (
            <button
              key={it.tmdb_id}
              className={`hero-dot ${i === index ? 'active' : ''}`}
              onClick={() => setIndex(i)}
              aria-label={`Destaque ${i + 1}`}
            />
          ))}
        </div>
      )}
    </section>
  )
}
