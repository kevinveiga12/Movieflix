import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Catálogo estático — UM único cache para todo o servidor.
 *
 * POR QUE ESTE MÓDULO EXISTE (medido em 2026-11-18)
 * `server/routes/catalog.js` e `server/lib/db-catalog.js` liam e parseavam os
 * mesmos arquivos em caches SEPARADOS. O catálogo tem 27 MB
 * (18.080 filmes + 8.093 séries); parseado duas vezes, o processo passava de
 * ~200 MB de RSS e o app era morto por falta de memória no plano Free da
 * Velixir — o site caía com "This web app isn't running" durante os testes.
 *
 * Aqui o parse acontece uma vez por arquivo e o mesmo array é compartilhado.
 * Nada de dado é alterado: é o mesmo JSON publicado em public/filmes/.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(__dirname, '..', '..', 'public', 'filmes')

/** Provedor de embed (MegaEmbed). Ver src/lib/player.ts. */
const EMBED_PROVIDER = 'https://mgeb.space'

const cache = { movie: null, tv: null }
const inflight = { movie: null, tv: null }

const FILES = { movie: 'filmes.light.json', tv: 'series.light.json' }

/**
 * Disponibilidade verificada no provedor.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * PLAYER ÚNICO: MEGAEMBED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * O proprietário pediu que o catálogo público mostre SOMENTE títulos que
 * realmente rodam no MegaEmbed. `public/filmes/megaembed-disponibilidade.json`
 * é gerado por `scripts/gerar-disponibilidade-megaembed.mjs` e contém a
 * interseção entre o nosso catálogo e o catálogo oficial do provedor
 * (`/api/movie` = 21.317 IDs, `/api/series` = 7.741 IDs).
 *
 * Medido em 2026-11-22: 15.415 filmes e 6.400 séries do nosso catálogo estão
 * no catálogo do MegaEmbed. Os outros 4.358 ficam fora da listagem pública —
 * os metadados continuam no JSON, só não são servidos.
 *
 * Regra: se o arquivo existir e tiver entradas, o catálogo mostra SOMENTE o
 * que está nele. Se o arquivo não existir (ou estiver vazio), não filtramos
 * nada — melhor mostrar o catálogo inteiro do que um site vazio por causa de
 * um arquivo ausente.
 */
let availability = null

async function loadAvailability() {
  if (availability) return availability
  try {
    const raw = await fs.readFile(path.join(PUBLIC, 'megaembed-disponibilidade.json'), 'utf8')
    const data = JSON.parse(raw)
    const movies = new Set((data.filmes ?? []).map(String))
    const series = new Set((data.series ?? []).map(String))
    availability = {
      movies,
      series,
      // Só filtra quando houve verificação de fato.
      active: movies.size > 0 || series.size > 0,
      geradoEm: data.gerado_em ?? null,
      provedor: data.provedor ?? null,
      reproducaoValidada: data.reproducao_validada === true,
    }
  } catch {
    availability = {
      movies: new Set(),
      series: new Set(),
      active: false,
      geradoEm: null,
      provedor: null,
      reproducaoValidada: false,
    }
  }
  return availability
}

/** Estatísticas da disponibilidade, para o painel/health. */
export async function availabilityStats() {
  const a = await loadAvailability()
  return {
    active: a.active,
    movies: a.movies.size,
    series: a.series.size,
    geradoEm: a.geradoEm,
    provedor: a.provedor,
    reproducaoValidada: a.reproducaoValidada,
  }
}

/**
 * Normaliza o `type` de um registro do catálogo estático.
 *
 * Os arquivos gravam `type: "series"` nas séries, mas TODO o servidor compara
 * com `'tv'` (rotas de episódio, autorização de reprodução, estatísticas).
 * Sem esta normalização, uma série vinda do catálogo estático:
 *   - caía no ramo de filme em /api/playback/authorize → "no_source";
 *   - não era reconhecida como série em seriesEpisodes.
 *
 * Não altera o array em cache: devolve uma cópia com `type`/`media_type` certos.
 */
function normalizeRecord(t) {
  if (!t || typeof t !== 'object') return t
  const raw = String(t.type ?? t.media_type ?? '').toLowerCase()
  const type = raw === 'tv' || raw === 'series' || raw === 'show' ? 'tv' : 'movie'

  // O JSON do catálogo foi gerado quando o provedor era o Streambetter e traz
  // `video_url` apontando para lá. Reescrevemos para o MegaEmbed na leitura,
  // sem tocar nos arquivos (18 mil registros) e sem depender de regeneração.
  //
  // Qualquer host de embed que não seja o MegaEmbed é reescrito — não só o
  // Streambetter. Assim nenhum resquício do player azul chega ao cliente.
  let video_url = t.video_url
  if (typeof video_url === 'string' && video_url && !/\.(mp4|m4v|webm|m3u8|mpd)(\?|#|$)/i.test(video_url)) {
    const host = (/^https?:\/\/([^/]+)/i.exec(video_url)?.[1] ?? '').toLowerCase()
    const isMega = host === 'mgeb.space' || host.endsWith('.mgeb.space')
    if (!isMega) {
      const id = String(t.tmdb_id ?? t.id ?? '')
      video_url = /^\d+$/.test(id) ? `${EMBED_PROVIDER}/embed/${id}` : ''
    }
  }

  if (t.type === type && t.media_type === type && video_url === t.video_url) return t
  return { ...t, type, media_type: type, video_url }
}

/**
 * Devolve a lista (já parseada) de filmes ou séries.
 * O array é compartilhado — NUNCA o mutar; use filter/map/slice.
 */
export async function loadStatic(kind) {
  if (cache[kind]) return cache[kind]
  if (inflight[kind]) return inflight[kind]

  inflight[kind] = (async () => {
    try {
      const raw = await fs.readFile(path.join(PUBLIC, FILES[kind]), 'utf8')
      const list = JSON.parse(raw)
      // Normaliza uma única vez, no parse — o resto do servidor só vê 'tv'/'movie'.
      let out = Array.isArray(list) ? list.map(normalizeRecord) : []

      // Filtra pelo que o provedor realmente entrega. Sem verificação, mantém tudo.
      const avail = await loadAvailability()
      if (avail.active) {
        const allowed = kind === 'movie' ? avail.movies : avail.series
        if (allowed.size) out = out.filter((t) => allowed.has(String(t.tmdb_id)))
      }

      cache[kind] = out
      return cache[kind]
    } catch {
      cache[kind] = []
      return []
    } finally {
      inflight[kind] = null
    }
  })()

  return inflight[kind]
}

/** Filmes e séries em uma chamada. */
export async function loadBoth() {
  const [movies, series] = await Promise.all([loadStatic('movie'), loadStatic('tv')])
  return { movies, series }
}

/** Busca por tmdb_id nas duas listas. */
export async function findStatic(tmdbId) {
  const id = Number(tmdbId)
  if (!Number.isFinite(id)) return null
  const { movies, series } = await loadBoth()
  return movies.find((t) => Number(t.tmdb_id) === id) ?? series.find((t) => Number(t.tmdb_id) === id) ?? null
}
