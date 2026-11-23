import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Hero } from '../components/Hero'
import { CarouselRow } from '../components/CarouselRow'
import { PosterCard } from '../components/PosterCard'
import { loadCatalog, featured, rowsForHome, getById, playableMovies, playableSeries, sortTitles } from '../lib/catalog'
import { sessionSeed } from '../lib/variety'
import { useInfiniteScroll } from '../lib/useInfiniteScroll'
import { useAuth } from '../context/AuthContext'
import { useHistory, parseEpisodeId } from '../lib/userData'
import { PlayIcon } from '../components/Icons'

/** Bloco de 50 cards por vez na grade "Explorar tudo". */
const PAGE_SIZE = 50

export function HomePage() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { user } = useAuth()
  const { continueWatching, progressFor } = useHistory()

  /**
   * Semente do DESTAQUE, nova a cada entrada na home.
   *
   * `sessionSeed()` é estável por aba — bom para as fileiras (não se
   * reorganizam enquanto a pessoa navega), mas o pedido é que o banner
   * principal mude a cada entrada na página inicial. Por isso o destaque usa
   * uma semente própria, criada uma vez por montagem do componente: voltar
   * para a home sorteia outro título, e ele não troca sozinho enquanto a
   * pessoa está olhando.
   */
  const heroSeed = useRef(`hero:${Date.now()}:${Math.random().toString(36).slice(2)}`).current

  /**
   * Fração assistida de um título, para a barrinha do card.
   * Devolve null quando não há progresso ou quando a duração é desconhecida
   * (modo embed) — nesse caso o card não mostra barra, em vez de mostrar 0%.
   */
  const progressOf = (tmdbId: string | number): number | null => {
    const h = progressFor(tmdbId)
    if (!h || !h.duration_seconds) return null
    const pct = h.position_seconds / h.duration_seconds
    return pct > 0.01 && pct < 0.98 ? pct : null
  }

  useEffect(() => {
    let alive = true
    loadCatalog()
      .then(() => alive && setReady(true))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  const heroes = useMemo(() => (ready ? featured(5, heroSeed) : []), [ready, heroSeed])
  const rows = useMemo(() => (ready ? rowsForHome(sessionSeed()) : []), [ready])

  /**
   * GRADE "EXPLORAR TUDO" — rolagem infinita de verdade na home.
   *
   * As fileiras acima mostram 20 títulos cada; a home terminava ali. Esta
   * grade percorre o catálogo inteiro (filmes + séries) em blocos de 50, até
   * o último título. É o que faz a página inicial nunca "acabar".
   */
  const explore = useMemo(() => {
    if (!ready) return []
    return sortTitles([...playableMovies(), ...playableSeries()], 'popular')
  }, [ready])
  const { visible, hasMore, loadMore, sentinelRef } = useInfiniteScroll(explore.length, PAGE_SIZE)
  const resume = useMemo(() => {
    if (!ready || !user) return []
    return continueWatching()
      .map((h) => {
        const t = getById(String(h.tmdb_id), h.media_type)
        if (!t) return null
        // Duração desconhecida (modo embed) → sem porcentagem inventada.
        const known = h.duration_seconds > 0
        const pct = known ? h.position_seconds / h.duration_seconds : 0
        return { t, pct, known, h }
      })
      .filter(Boolean)
      .slice(0, 12) as Array<{
      t: NonNullable<ReturnType<typeof getById>>
      pct: number
      known: boolean
      h: any
    }>
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
      {/* Marca no topo da home. No site a navbar já mostra "MovieFlix"; dentro
          do app a navbar é escondida, então esta faixa é o que mantém a marca
          visível — como era antes. O CSS só a exibe em modo aplicativo. */}
      <div className="home-brand">
        <img src="/icon-192.png" alt="" />
        <span className="brand-word">Movieflix</span>
      </div>

      <Hero items={heroes} />

      <div className="page">
        {resume.length > 0 && (
          <CarouselRow title="Continuar assistindo">
            {resume.map(({ t, pct, known, h }) => {
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
                  {known && (
                    <div className="card-progress">
                      <span style={{ width: `${Math.min(100, pct * 100)}%` }} />
                    </div>
                  )}
                </div>
                <div className="card-info">
                  <div className="card-title">{t.title}</div>
                  <div className="card-sub">
                    {ep ? <span>T{ep.season} E{ep.episode}</span> : <span>Filme</span>}
                    {known && <span>· {Math.round(pct * 100)}% assistido</span>}
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
              <PosterCard key={`${t.type}-${t.tmdb_id}`} title={t} progress={progressOf(t.tmdb_id)} />
            ))}
          </CarouselRow>
        ))}

        {!rows.length && (
          <div className="empty">
            <h3>Catálogo vazio</h3>
            <p>Nenhum título com fonte de reprodução disponível no momento.</p>
          </div>
        )}

        {/*
          GRADE INFINITA.

          Depois das fileiras, o catálogo inteiro em blocos de 50. O sentinela
          fica no fim; quando entra na viewport, o próximo bloco entra sozinho.
          A mensagem de fim só aparece quando o catálogo realmente acaba.
        */}
        {explore.length > 0 && (
          <section className="home-explore">
            <div className="row-head">
              <h2 className="row-title">Explorar tudo</h2>
              <span className="row-count">{explore.length} títulos</span>
            </div>

            <div className="grid">
              {explore.slice(0, visible).map((t) => (
                <PosterCard key={`${t.type}-${t.tmdb_id}`} title={t} progress={progressOf(t.tmdb_id)} />
              ))}
            </div>

            <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />

            {hasMore ? (
              <div className="center" style={{ marginTop: 28, paddingBottom: 24 }}>
                <div className="infinite-loading" role="status" aria-live="polite">
                  <span className="infinite-spinner" aria-hidden="true" />
                  Carregando mais títulos…
                </div>
                <button className="btn btn--ghost" style={{ marginTop: 12 }} onClick={loadMore}>
                  Carregar mais ({explore.length - visible} restantes)
                </button>
              </div>
            ) : (
              <div className="center infinite-end" style={{ marginTop: 28, paddingBottom: 24 }}>
                Você chegou ao fim — {explore.length} títulos.
              </div>
            )}
          </section>
        )}
      </div>
    </>
  )
}
