import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PosterCard } from '../components/PosterCard'
import {
  loadCatalog,
  playableMovies,
  playableSeries,
  genresOf,
  byGenre,
  sortTitles,
  SORT_LABELS,
  type SortKey,
} from '../lib/catalog'

interface Props {
  kind: 'movie' | 'tv'
}

const PAGE_SIZE = 60

export function CatalogPage({ kind }: Props) {
  const [params, setParams] = useSearchParams()
  const [ready, setReady] = useState(false)
  const [visible, setVisible] = useState(PAGE_SIZE)

  const genre = params.get('genero') ?? 'Todos'
  const sort = (params.get('ordem') as SortKey) ?? 'popular'

  useEffect(() => {
    loadCatalog().then(() => setReady(true))
  }, [])

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [genre, sort, kind])

  const all = useMemo(() => (ready ? (kind === 'movie' ? playableMovies() : playableSeries()) : []), [ready, kind])
  const genres = useMemo(() => ['Todos', ...genresOf(all)], [all])
  const filtered = useMemo(() => sortTitles(byGenre(all, genre), sort), [all, genre, sort])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value === 'Todos' || value === 'popular') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const label = kind === 'movie' ? 'Filmes' : 'Séries'

  return (
    <div className="page" style={{ paddingTop: 32 }}>
      <div className="section-head">
        <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.2rem)' }}>
          {label}
        </h1>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {ready ? `${filtered.length} títulos` : 'Carregando…'}
        </span>
      </div>

      <div className="filters">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 }}>
          {genres.slice(0, 14).map((g) => (
            <button
              key={g}
              className={`chip ${genre === g ? 'active' : ''}`}
              onClick={() => setParam('genero', g)}
            >
              {g}
            </button>
          ))}
        </div>
        <select
          className="select"
          value={sort}
          onChange={(e) => setParam('ordem', e.target.value)}
          aria-label="Ordenar por"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {!ready ? (
        <div className="grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <h3>Nenhum título encontrado</h3>
          <p>Tente outro gênero ou remova os filtros.</p>
          <button className="btn btn--outline" onClick={() => setParams({}, { replace: true })}>
            Limpar filtros
          </button>
        </div>
      ) : (
        <>
          <div className="grid">
            {filtered.slice(0, visible).map((t) => (
              <PosterCard key={`${t.type}-${t.tmdb_id}`} title={t} />
            ))}
          </div>
          {visible < filtered.length && (
            <div className="center" style={{ marginTop: 36 }}>
              <button className="btn btn--outline btn--lg" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Carregar mais ({filtered.length - visible} restantes)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
