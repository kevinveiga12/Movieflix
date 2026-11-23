import type { Title, MediaType } from './types'
import { sessionSeed, sampleWithSeed } from './variety'

/**
 * Catálogo estático servido de /filmes/*.json.
 *
 * O catálogo é gerado offline (scripts/gerar-catalogo.mjs) a partir do TMDB e
 * publicado junto com o build. Isso mantém a home instantânea e evita gastar
 * cota da API do TMDB a cada visita. O painel administrativo pode regenerar.
 */

/**
 * Provedor ÚNICO de reprodução: MegaEmbed (o player vermelho).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O PLAYER AZUL SAIU
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * O proprietário pediu um player só. O player azul (myembed.biz →
 * playerflix.ink → v1.watchplay.shop) não é mais usado em lugar nenhum: não há
 * trocador de servidor, não há fallback, não há embed antigo.
 *
 * O catálogo publicado foi gerado quando o provedor era o StreamBetter e traz
 * `video_url` apontando para `streambetter.shop` em todos os registros. O
 * servidor já reescreve isso na leitura (server/lib/static-catalog.js), mas o
 * NAVEGADOR lê este JSON direto de /filmes/*.json — sem a mesma reescrita, a
 * URL antiga continuava chegando ao cliente.
 *
 * A normalização aqui garante que nenhum host de embed que não seja o MegaEmbed
 * exista em nenhum ponto do app.
 */
export const EMBED_PROVIDER = 'https://mgeb.space'

const EMBED_HOST = /^https?:\/\/([^/]+)/i

/** Reescreve uma URL de embed de outro provedor para o MegaEmbed. */
function normalizeVideoUrl(raw: string | null | undefined, tmdbId: number): string {
  const url = String(raw ?? '').trim()
  if (!url) return ''
  // Arquivo direto (MP4/HLS) cadastrado pelo admin: preservado como está.
  if (/\.(mp4|m4v|webm|m3u8|mpd)(\?|#|$)/i.test(url)) return url
  const m = EMBED_HOST.exec(url)
  if (!m) return url
  const host = m[1].toLowerCase()
  if (host === 'mgeb.space' || host.endsWith('.mgeb.space')) return url
  // Qualquer outro provedor de embed (myembed.biz, streambetter.shop…) → MegaEmbed.
  return tmdbId > 0 ? `${EMBED_PROVIDER}/embed/${tmdbId}` : ''
}

let moviesCache: Title[] | null = null
let seriesCache: Title[] | null = null
let loading: Promise<void> | null = null

/**
 * IDs que o MegaEmbed realmente serve.
 *
 * `public/filmes/megaembed-disponibilidade.json` é gerado por
 * `scripts/gerar-disponibilidade-megaembed.mjs` a partir do catálogo oficial do
 * provedor (`/api/movie` = 21.317 IDs, `/api/series` = 7.741 IDs).
 *
 * O catálogo público mostra SOMENTE o que está aqui. Título fora da lista não
 * aparece na home, na busca, nas categorias nem nos relacionados — mas os
 * metadados continuam no JSON, nada é apagado.
 *
 * Se o arquivo não existir, `active` fica `false` e nada é filtrado: melhor
 * mostrar o catálogo inteiro do que um site vazio por causa de um arquivo
 * ausente.
 */
interface Availability {
  movies: Set<string>
  series: Set<string>
  active: boolean
  /**
   * Episódios com fonte limpa, por série: `{ "5920": ["1/1","1/2"] }`.
   *
   * Vazio quando o arquivo é o antigo — nesse caso nada é filtrado por
   * episódio e o player consulta o provedor na hora.
   */
  episodes: Record<string, string[]>
}

let availability: Availability | null = null

/**
 * IDs ocultados pelo painel administrativo.
 *
 * ── Por que o cliente também filtra ────────────────────────────────────────
 * O site lê o catálogo de `/filmes/*.json`, um arquivo ESTÁTICO com cache de 7
 * dias. O servidor filtra as rotas `/api/catalog/*`, mas esse JSON não passa
 * por elas — então um título ocultado no painel continuaria na home até o
 * próximo build.
 *
 * `GET /api/catalog/hidden` devolve só os IDs (resposta de poucos KB) e aqui
 * eles são removidos junto com o filtro de disponibilidade. Resultado: ocultar
 * no painel vale no site na hora, sem rebuild.
 *
 * Se a rota falhar, `active` fica `false` e nada é filtrado — o site continua
 * funcionando com o catálogo completo em vez de ficar vazio.
 */
interface HiddenList {
  movies: Set<string>
  series: Set<string>
  active: boolean
}

let hiddenList: HiddenList | null = null

async function loadHidden(): Promise<HiddenList> {
  if (hiddenList) return hiddenList
  try {
    const res = await fetch('/api/catalog/hidden', { cache: 'no-cache' })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { filmes?: number[]; series?: number[] }
    const movies = new Set((data.filmes ?? []).map(String))
    const series = new Set((data.series ?? []).map(String))
    hiddenList = { movies, series, active: movies.size > 0 || series.size > 0 }
  } catch {
    hiddenList = { movies: new Set(), series: new Set(), active: false }
  }
  return hiddenList
}

/**
 * Descarta o cache da lista de ocultos.
 *
 * O painel chama isto depois de ocultar/reexibir, para a mudança aparecer na
 * mesma sessão do navegador sem precisar recarregar a página.
 */
export function invalidateHiddenCache(): void {
  hiddenList = null
}

async function loadAvailability(): Promise<Availability> {
  if (availability) return availability
  /*
    LISTA = `megaembed-disponibilidade.json` (12.672 filmes / 1.965 séries).

    É o catálogo que o cliente já conhece. O `fontes-limpas.json` é mais
    restrito (7.307 filmes / 171 séries) e usá-lo aqui derrubaria 42% dos
    filmes e 91% das séries — regressão que ninguém pediu.

    A eliminação do anúncio não depende deste arquivo: ela acontece no
    servidor (`server/routes/access.js`), que só aceita o embed quando ele é
    `watchplay` e descarta o `embedplayer` (o iframe com pop-up).
  */
  try {
    const res = await fetch('/filmes/megaembed-disponibilidade.json')
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { filmes?: number[]; series?: number[] }
    const movies = new Set((data.filmes ?? []).map(String))
    const series = new Set((data.series ?? []).map(String))
    availability = { movies, series, active: movies.size > 0 || series.size > 0, episodes: {} }
  } catch {
    availability = { movies: new Set(), series: new Set(), active: false, episodes: {} }
  }
  return availability
}

/**
 * Episódios com fonte limpa, por série — sinal ADICIONAL.
 *
 * `fontes-limpas.json` traz `{ "5920": ["1/1","1/2"] }`: os episódios cuja
 * fonte `watchplay` foi medida. Serve para NÃO oferecer um episódio que só
 * existe no `embedplayer` (o iframe com anúncio).
 *
 * Só restringe as séries que aparecem no arquivo. Série ausente fica com a
 * lista original — o servidor decide na hora, episódio a episódio.
 */
let cleanEpisodes: Record<string, string[]> | null = null

async function loadCleanEpisodes(): Promise<Record<string, string[]>> {
  if (cleanEpisodes) return cleanEpisodes
  try {
    const res = await fetch('/filmes/fontes-limpas.json')
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { episodios?: Record<string, string[]> }
    cleanEpisodes = data.episodios ?? {}
  } catch {
    cleanEpisodes = {}
  }
  return cleanEpisodes
}

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
    const [movies, series, avail, hidden, clean] = await Promise.all([
      loadJson<Title[]>('/filmes/filmes.light.json'),
      loadJson<Title[]>('/filmes/series.light.json'),
      loadAvailability(),
      loadHidden(),
      loadCleanEpisodes(),
    ])
    const keep = (list: Title[], allowed: Set<string>, blocked: Set<string>) => {
      let out = avail.active ? list.filter((t) => allowed.has(String(t.tmdb_id))) : list
      if (hidden.active) out = out.filter((t) => !blocked.has(String(t.tmdb_id)))
      return out
    }
    moviesCache = keep(movies, avail.movies, hidden.movies).map(normalizeTitle)
    seriesCache = keep(series, avail.series, hidden.series).map(normalizeTitle)

    /*
      FILTRO POR EPISÓDIO.

      Uma série pode estar disponível mas ter episódios sem fonte limpa. Sem
      isto, o cliente abriria o E1 de uma série cujo E1 só existe no
      `embedplayer` (o iframe com anúncio) — exatamente o problema relatado.

      Só restringe as séries presentes em `fontes-limpas.json`. Série ausente
      mantém a lista original: o servidor decide na hora, episódio a episódio,
      e um episódio sem fonte limpa diz "não está rodando" em vez de abrir
      propaganda.
    */
    if (Object.keys(clean).length) {
      seriesCache = seriesCache.map((t) => {
        const ok = clean[String(t.tmdb_id)]
        return ok && ok.length ? { ...t, episodes_available: ok } : t
      })
    }
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

/**
 * Destaques da home: os mais populares que realmente tocam.
 *
 * Com `seed`, sorteia 5 entre os 40 mais populares — o herói da home também
 * muda a cada acesso, sem trazer um título irrelevante para a primeira dobra.
 */
export function featured(count = 5, seed?: string): Title[] {
  const pool = sortTitles(playableMovies(), 'popular').slice(0, 40)
  if (!seed) return pool.slice(0, count)
  return sampleWithSeed(pool, count, `${seed}:hero`)
}

/**
 * Fileiras da home, com variedade por sessão.
 *
 * ── O que mudou e por quê ───────────────────────────────────────────────────
 *
 * Antes cada fileira era `sortTitles(...).slice(0, 20)` — os MESMOS 20 títulos
 * em todo acesso, sempre na mesma ordem. Agora cada fileira monta um pool
 * maior (os 200 melhores segundo o critério da fileira) e SORTEIA 20 dele com
 * a semente da sessão.
 *
 * O critério da fileira é preservado: "Lançamentos" continua trazendo títulos
 * recentes, "Em alta" continua trazendo populares, cada gênero continua sendo
 * aquele gênero. O que varia é QUAIS títulos do pool aparecem.
 *
 * A semente é a mesma durante toda a sessão, então a home não se reorganiza
 * enquanto a pessoa navega — e muda por completo no próximo acesso.
 */
export function rowsForHome(seed: string = sessionSeed()): Array<{ title: string; items: Title[] }> {
  const movies = playableMovies()
  const series = playableSeries()
  const rows: Array<{ title: string; items: Title[] }> = []

  /** Pool de 200 + amostra de 20: variedade sem perder o critério da fileira. */
  const pick = (list: Title[], key: SortKey, tag: string) =>
    sampleWithSeed(sortTitles(list, key).slice(0, 200), 20, `${seed}:${tag}`)

  const recent = pick(movies, 'recent', 'recent')
  if (recent.length) rows.push({ title: 'Lançamentos', items: recent })

  const popular = pick(movies, 'popular', 'popular')
  if (popular.length) rows.push({ title: 'Em alta', items: popular })

  const seriesRow = pick(series, 'popular', 'series')
  if (seriesRow.length) rows.push({ title: 'Séries', items: seriesRow })

  const topRated = sampleWithSeed(
    sortTitles(movies, 'rating').filter((t) => (t.vote_average ?? 0) >= 6).slice(0, 200),
    20,
    `${seed}:top`,
  )
  if (topRated.length) rows.push({ title: 'Aclamados pela crítica', items: topRated })

  for (const genre of ['Ação', 'Comédia', 'Terror', 'Drama', 'Suspense', 'Animação', 'Romance']) {
    const items = sampleWithSeed(
      sortTitles(byGenre(movies, genre), 'popular').slice(0, 200),
      20,
      `${seed}:g:${genre}`,
    )
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
