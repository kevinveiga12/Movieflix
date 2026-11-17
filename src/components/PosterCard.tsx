import { Link } from 'react-router-dom'
import { memo } from 'react'
import type { Title } from '../lib/types'
import { posterUrl } from '../lib/catalog'
import { PlayIcon, StarIcon } from './Icons'

interface Props {
  title: Title
  progress?: number | null
  wide?: boolean
  showBadge?: boolean
}

export const PosterCard = memo(function PosterCard({ title, progress, wide, showBadge = true }: Props) {
  const href = `/titulo/${title.type}/${title.tmdb_id}`
  const rating = title.vote_average ? title.vote_average.toFixed(1) : null
  const pct = progress != null ? Math.min(100, Math.max(0, progress * 100)) : null

  return (
    <Link
      to={href}
      className={`card ${wide ? 'card--wide' : ''}`}
      aria-label={`${title.title}${title.year ? `, ${title.year}` : ''}`}
    >
      <div className="card-poster">
        <img
          src={posterUrl(title, wide ? 'w500' : 'w342')}
          alt={title.title}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            const el = e.currentTarget
            if (!el.src.endsWith('/icon-192.png')) el.src = '/icon-192.png'
          }}
        />
        {showBadge && title.dublado_ptbr && <span className="card-badge">Dublado</span>}
        {rating && (
          <span className="card-rating">
            <StarIcon size={10} /> {rating}
          </span>
        )}
        <div className="card-play">
          <span>
            <PlayIcon size={20} />
          </span>
        </div>
        {pct != null && pct > 0 && (
          <div className="card-progress">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="card-info">
        <div className="card-title">{title.title}</div>
        <div className="card-sub">
          {title.year && <span>{title.year}</span>}
          {title.type === 'tv' && title.seasons ? <span>· {title.seasons} temp.</span> : null}
          {title.category && <span>· {title.category}</span>}
        </div>
      </div>
    </Link>
  )
})
