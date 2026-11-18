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

const cache = { movie: null, tv: null }
const inflight = { movie: null, tv: null }

const FILES = { movie: 'filmes.light.json', tv: 'series.light.json' }

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
  if (t.type === type && t.media_type === type) return t
  return { ...t, type, media_type: type }
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
      cache[kind] = Array.isArray(list) ? list.map(normalizeRecord) : []
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
