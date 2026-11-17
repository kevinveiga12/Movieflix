import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { PosterCard } from '../components/PosterCard'
import { SearchIcon, XIcon } from '../components/Icons'
import { loadCatalog, searchTitles, sortTitles, playableMovies, playableSeries } from '../lib/catalog'

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(query)
  const [filter, setFilter] = useState<'all' | 'movie' | 'tv'>('all')

  useEffect(() => {
    loadCatalog().then(() => setReady(true))
  }, [])

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 220)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    const next = new URLSearchParams(params)
    if (debounced.trim()) next.set('q', debounced.trim())
    else next.delete('q')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const results = useMemo(() => {
    if (!ready || !debounced.trim()) return []
    const type = filter === 'all' ? undefined : filter
    return searchTitles(debounced, type).slice(0, 200)
  }, [ready, debounced, filter])

  const suggestions = useMemo(() => {
    if (!ready || debounced.trim()) return []
    return sortTitles(playableMovies(), 'popular').slice(0, 12)
  }, [ready, debounced])

  return (
    <div className="page" style={{ paddingTop: 32 }}>
      <div className="search-bar">
        <SearchIcon size={20} />
        <input
          autoFocus
          type="search"
          placeholder="Buscar filmes e séries…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') navigate(-1)
          }}
          aria-label="Buscar títulos"
        />
        {query && (
          <button
            className="icon-btn"
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}
            onClick={() => setQuery('')}
            aria-label="Limpar busca"
          >
            <XIcon size={18} />
          </button>
        )}
      </div>

      <div className="filters" style={{ justifyContent: 'center' }}>
        {(
          [
            ['all', 'Tudo'],
            ['movie', 'Filmes'],
            ['tv', 'Séries'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      {!ready ? (
        <div className="grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : debounced.trim() ? (
        results.length ? (
          <>
            <p className="muted" style={{ marginBottom: 18, fontSize: '0.88rem' }}>
              {results.length} resultado(s) para “{debounced}”
            </p>
            <div className="grid">
              {results.map((t) => (
                <PosterCard key={`${t.type}-${t.tmdb_id}`} title={t} />
              ))}
            </div>
          </>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <SearchIcon size={30} />
            </div>
            <h3>Nada encontrado para “{debounced}”</h3>
            <p>Verifique a grafia ou tente um termo mais curto.</p>
          </div>
        )
      ) : (
        <>
          <div className="section-head">
            <h2 className="section-title">Populares agora</h2>
          </div>
          <div className="grid">
            {suggestions.map((t) => (
              <PosterCard key={`${t.type}-${t.tmdb_id}`} title={t} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
