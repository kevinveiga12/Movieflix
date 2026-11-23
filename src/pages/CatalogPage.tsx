import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PosterCard } from '../components/PosterCard'
import { SearchIcon, XIcon } from '../components/Icons'
import { useHistory } from '../lib/userData'
import {
  loadCatalog,
  playableMovies,
  playableSeries,
  genresOf,
  byGenre,
  sortTitles,
  searchTitles,
  SORT_LABELS,
  type SortKey,
} from '../lib/catalog'
import { sessionSeed, applyVariety } from '../lib/variety'

interface Props {
  kind: 'movie' | 'tv'
}

const PAGE_SIZE = 60

export function CatalogPage({ kind }: Props) {
  const [params, setParams] = useSearchParams()
  const [ready, setReady] = useState(false)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const { progressFor } = useHistory()

  /**
   * Barrinha de progresso nos cards de catálogo.
   * null quando não há progresso ou a duração é desconhecida (modo embed).
   */
  const progressOf = (tmdbId: string | number): number | null => {
    const h = progressFor(tmdbId)
    if (!h || !h.duration_seconds) return null
    const pct = h.position_seconds / h.duration_seconds
    return pct > 0.01 && pct < 0.98 ? pct : null
  }

  const genre = params.get('genero') ?? 'Todos'
  const sort = (params.get('ordem') as SortKey) ?? 'popular'
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(query)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 180)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    loadCatalog().then(() => setReady(true))
  }, [])

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [genre, sort, kind, debounced])

  const all = useMemo(() => (ready ? (kind === 'movie' ? playableMovies() : playableSeries()) : []), [ready, kind])
  const genres = useMemo(() => ['Todos', ...genresOf(all)], [all])

  /**
   * Busca dentro da própria aba.
   *
   * Antes só existia a página /pesquisa, escondida atrás do ícone da navbar —
   * e no app a navbar não aparece. Aqui a busca filtra o catálogo já carregado
   * (sem requisição nova) e respeita o tipo da aba: em Filmes procura filmes,
   * em Séries procura séries.
   */
  const searched = useMemo(() => {
    const q = debounced.trim()
    if (!q) return all
    return searchTitles(q, kind === 'movie' ? 'movie' : 'tv')
  }, [all, debounced, kind])

  /**
   * Lista filtrada e ordenada.
   *
   * A variedade por sessão só se aplica à ordem PADRÃO ("Mais populares").
   * Quando a pessoa escolhe A–Z, Mais recentes, Mais antigos ou Melhor
   * avaliados, a ordem pedida é respeitada ao pé da letra — variar ali seria
   * quebrar a própria escolha dela.
   *
   * A busca também não é embaralhada: quem procura um título quer o resultado
   * mais relevante primeiro, não uma combinação diferente a cada acesso.
   */
  const filtered = useMemo(() => {
    const sorted = sortTitles(byGenre(searched, genre), sort)
    const canVary = sort === 'popular' && !debounced.trim()
    return canVary ? applyVariety(sorted, sessionSeed()) : sorted
  }, [searched, genre, sort, debounced])

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

      <div className="search-bar" style={{ margin: '0 0 16px', maxWidth: '100%' }}>
        <SearchIcon size={20} />
        <input
          type="search"
          placeholder={kind === 'movie' ? 'Buscar filme…' : 'Buscar série…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={kind === 'movie' ? 'Buscar filme' : 'Buscar série'}
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
          <h3>{debounced.trim() ? `Nada encontrado para “${debounced.trim()}”` : 'Nenhum título encontrado'}</h3>
          <p>
            {debounced.trim()
              ? 'Verifique a grafia ou tente um termo mais curto.'
              : 'Tente outro gênero ou remova os filtros.'}
          </p>
          <button
            className="btn btn--outline"
            onClick={() => {
              setQuery('')
              setParams({}, { replace: true })
            }}
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <>
          <div className="grid">
            {filtered.slice(0, visible).map((t) => (
              <PosterCard key={`${t.type}-${t.tmdb_id}`} title={t} progress={progressOf(t.tmdb_id)} />
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
