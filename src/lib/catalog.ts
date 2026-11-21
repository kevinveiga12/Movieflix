import type { Title, MediaType } from './types'

/**
 * Catálogo estático servido de /filmes/*.json.
 *
 * O catálogo é gerado offline (scripts/gerar-catalogo.mjs) a partir do TMDB e
 * publicado junto com o build. Isso mantém a home instantânea e evita gastar
 * cota da API do TMDB a cada visita. O painel administrativo pode regenerar.
 */

/**
 * Provedor ÚNICO de reprodução: o player azul (EmbedMovies / myembed.biz).
 *
 * O catálogo publicado foi gerado quando o provedor era o StreamBetter e traz
 * `video_url` apontando para `streambetter.shop` em todos os 18.080 filmes.
 * O servidor já reescreve isso na leitura (server/lib/static-catalog.js), mas o
 * NAVEGADOR lê este JSON direto de /filmes/*.json — sem a mesma reescrita, a
 * URL do StreamBetter continuava chegando ao cliente (e era ela que aparecia
 * em "com fonte" e em qualquer caminho que usasse `video_url`).
 *
 * A normalização aqui garante que o StreamBetter não exista em nenhum ponto do
 * app: qualquer host de embed que não seja o player azul vira o player azul.
 */
export const EMBED_PROVIDER = 'https://myembed.biz'

const EMBED_HOST = /^https?:\/\/([^/]+)/i

/** Reescreve uma URL de embed de outro provedor para o player azul. */
function normalizeVideoUrl(raw: string | null | undefined, tmdbId: number): string {
  const url = String(raw ?? '').trim()
  if (!url) return ''
  // Arquivo direto (MP4/HLS) cadastrado pelo admin: preservado como está.
  if (/\.(mp4|m4v|webm|m3u8|mpd)(\?|#|$)/i.test(url)) return url
  const m = EMBED_HOST.exec(url)
  if (!m) return url
  const host = m[1].toLowerCase()
  if (host === 'myembed.biz' || host.endsWith('.myembed.biz')) return url
  // Qualquer outro provedor de embed (streambetter.shop, etc.) → player azul.
  return tmdbId > 0 ? `${EMBED_PROVIDER}/filme/${tmdbId}` : ''
}

let moviesCache: Title[] | null = null
let seriesCache: Title[] | null = null
let loading: Promise<void> | null = null

async function loadJson<T>(path: string): Promise<T> {
  // `force-cache` foi removido: ele servia uma resposta antiga (inclusive um
  // 502 em cache) sem nunca revalidar. O cache agora é do service worker
  // (cache-first com revalidação em segundo plano) e do HTTP (Cache-Control
  // longo no servidor), então aqui basta o fetch normal.
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Falha ao carregar ${path} (${res.status})`)
  return (await res.json()) as T
}

/**
 * Normaliza o `type` de um título.
 *
 * O gerador do catálogo grava `type: "series"` nas séries, mas todo o resto do
 * app (player, detalhe, cards, filtros) trabalha com `"tv"`. Sem esta
 * normalização, 8.093 séries ficavam com um tipo que nenhuma comparação
 * reconhecia: a página da série dizia "não encontrada", o player tratava como
 * filme e o botão de episódio não aparecia.
 *
 * Aceita também `media_type` como pista quando `type` vem ausente ou inválido.
 */
function normalizeType(raw: Partial<Title>): MediaType {
  const value = String(raw.type ?? raw.media_type ?? '').toLowerCase()
  if (value === 'tv' || value === 'series' || value === 'show') return 'tv'
  return 'movie'
}

/** Aplica a normalização sem descartar nenhum campo do registro original. */
function normalizeTitle(raw: Title): Title {
  const type = normalizeType(raw)
  return {
    ...raw,
    id: String(raw.id ?? raw.tmdb_id ?? ''),
    tmdb_id: Number(raw.tmdb_id ?? raw.id ?? 0),
    type,
    media_type: type,
    category: raw.category ?? '',
    description: raw.description ?? '',
    poster_url: raw.poster_url ?? '',
    backdrop_url: raw.backdrop_url ?? '',
    video_url: normalizeVideoUrl(raw.video_url, Number(raw.tmdb_id ?? raw.id ?? 0)),
    episodes_available: Array.isArray(raw.episodes_available) ? raw.episodes_available : [],
  }
}

export async function loadCatalog(): Promise<void> {
  if (moviesCache && seriesCache) return
  if (loading) return loading
  loading = (async () => {
    const [movies, series] = await Promise.all([
      loadJson<Title[]>('/filmes/filmes.light.json'),
      loadJson<Title[]>('/filmes/series.light.json'),
    ])
    moviesCache = movies.map(normalizeTitle)
    seriesCache = series.map(normalizeTitle)
  })()
  try {
    await loading
  } finally {
    loading = null
  }
}

export function getMovies(): Title[] {
  return moviesCache ?? []
}

export function getSeries(): Title[] {
  return seriesCache ?? []
}

export function getAll(): Title[] {
  return [...getMovies(), ...getSeries()]
}

/**
 * Busca um título por id.
 *
 * Procura primeiro no conjunto indicado por `type`, mas cai para o catálogo
 * inteiro quando não encontra — assim um link antigo ou um parâmetro de tipo
 * errado (`?type=movie` numa série) ainda abre o conteúdo certo em vez de
 * mostrar "não encontrado".
 */
export function getById(id: string, type?: MediaType): Title | undefined {
  const key = String(id)
  const match = (pool: Title[]) =>
    pool.find((t) => String(t.tmdb_id) === key || t.id === key)

  if (type === 'movie' || type === 'tv') {
    return match(type === 'movie' ? getMovies() : getSeries()) ?? match(getAll())
  }
  return match(getAll())
}

/** Somente títulos com fonte de vídeo configurada são reproduzíveis. */
export function isPlayable(t: Title): boolean {
  if (t.type === 'tv') return Boolean(t.episodes_available?.length)
  return Boolean(t.video_url)
}

export function playableMovies(): Title[] {
  return getMovies().filter(isPlayable)
}

export function playableSeries(): Title[] {
  return getSeries().filter(isPlayable)
}

export function genresOf(list: Title[]): string[] {
  const set = new Set<string>()
  for (const t of list) {
    if (!t.category) continue
    // Categorias vêm compostas ("Ação, Animação, Família") — separa em termos.
    for (const g of t.category.split(',')) {
      const clean = g.trim()
      if (clean) set.add(clean)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export function byGenre(list: Title[], genre: string): Title[] {
  if (!genre || genre === 'Todos') return list
  const wanted = genre.toLowerCase()
  return list.filter((t) =>
    (t.category ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .includes(wanted),
  )
}

export type SortKey = 'popular' | 'recent' | 'oldest' | 'az' | 'rating'

export function sortTitles(list: Title[], sort: SortKey): Title[] {
  const copy = [...list]
  switch (sort) {
    case 'recent':
      return copy.sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
    case 'oldest':
      return copy.sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''))
    case 'az':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
    case 'rating':
      return copy.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
    case 'popular':
    default:
      return copy.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
  }
}

export const SORT_LABELS: Record<SortKey, string> = {
  popular: 'Mais populares',
  recent: 'Mais recentes',
  oldest: 'Mais antigos',
  az: 'A–Z',
  rating: 'Melhor avaliados',
}

/** Normaliza para busca: minúsculas e sem acentos. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function searchTitles(query: string, type?: MediaType): Title[] {
  const q = normalize(query.trim())
  if (!q) return []
  const pool = type === 'movie' ? getMovies() : type === 'tv' ? getSeries() : getAll()
  const terms = q.split(/\s+/).filter(Boolean)
  const scored: Array<{ t: Title; score: number }> = []
  for (const t of pool) {
    const title = normalize(t.title)
    const desc = normalize(t.description ?? '')
    let score = 0
    let allMatch = true
    for (const term of terms) {
      if (title.startsWith(term)) score += 100
      else if (title.includes(term)) score += 50
      else if (desc.includes(term)) score += 10
      else allMatch = false
    }
    if (!allMatch) continue
    score += (t.popularity ?? 0) / 1000
    scored.push({ t, score })
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.t)
}

/** Destaques da home: os mais populares que realmente tocam. */
export function featured(count = 5): Title[] {
  return sortTitles(playableMovies(), 'popular').slice(0, count)
}

export function rowsForHome(): Array<{ title: string; items: Title[] }> {
  const movies = playableMovies()
  const series = playableSeries()
  const rows: Array<{ title: string; items: Title[] }> = []

  const recent = sortTitles(movies, 'recent').slice(0, 20)
  if (recent.length) rows.push({ title: 'Lançamentos', items: recent })

  const popular = sortTitles(movies, 'popular').slice(0, 20)
  if (popular.length) rows.push({ title: 'Em alta', items: popular })

  const seriesRow = sortTitles(series, 'popular').slice(0, 20)
  if (seriesRow.length) rows.push({ title: 'Séries', items: seriesRow })

  const topRated = sortTitles(movies, 'rating')
    .filter((t) => (t.vote_average ?? 0) >= 6)
    .slice(0, 20)
  if (topRated.length) rows.push({ title: 'Aclamados pela crítica', items: topRated })

  for (const genre of ['Ação', 'Comédia', 'Terror', 'Drama', 'Suspense', 'Animação', 'Romance']) {
    const items = sortTitles(byGenre(movies, genre), 'popular').slice(0, 20)
    if (items.length >= 6) rows.push({ title: genre, items })
  }

  return rows
}

export function relatedTo(t: Title, count = 12): Title[] {
  const pool = t.type === 'movie' ? playableMovies() : playableSeries()
  return pool
    .filter((x) => x.tmdb_id !== t.tmdb_id && x.category === t.category)
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, count)
}

export function posterUrl(t: Title, size: 'w342' | 'w500' = 'w342'): string {
  const url = t.poster_url ?? ''
  if (!url) return '/icon-192.png'
  return url.replace('/w500/', `/${size}/`)
}

export function backdropUrl(t: Title): string {
  return t.backdrop_url || t.poster_url || ''
}
