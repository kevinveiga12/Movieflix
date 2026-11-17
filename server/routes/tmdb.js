import { Router } from 'express'
import rateLimit from 'express-rate-limit'

/**
 * Proxy do TMDB.
 *
 * A API key do TMDB fica SÓ no servidor (TMDB_API_KEY). O navegador nunca a vê.
 * Isso evita que a chave seja extraída do bundle e permite cache no servidor.
 */

const router = Router()

const TMDB = 'https://api.themoviedb.org/3'
const KEY = process.env.TMDB_API_KEY
const LANG = process.env.TMDB_LANG ?? 'pt-BR'

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas buscas. Aguarde um instante.' },
})

const cache = new Map()
const TTL = 5 * 60_000

function cached(key) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.data
  return null
}

function put(key, data) {
  if (cache.size > 300) cache.clear()
  cache.set(key, { at: Date.now(), data })
}

async function tmdb(pathname, params = {}) {
  if (!KEY) {
    const err = new Error('TMDB_API_KEY não configurada no servidor.')
    err.status = 503
    throw err
  }
  const url = new URL(`${TMDB}${pathname}`)
  url.searchParams.set('api_key', KEY)
  url.searchParams.set('language', LANG)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }

  const key = url.toString().replace(KEY, 'KEY')
  const hit = cached(key)
  if (hit) return hit

  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    const err = new Error(`TMDB respondeu ${res.status}`)
    err.status = res.status === 401 ? 502 : 502
    throw err
  }
  const data = await res.json()
  put(key, data)
  return data
}

router.use(limiter)

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim()
    if (!q) return res.json({ results: [] })
    const data = await tmdb('/search/multi', { query: q, include_adult: 'false', page: req.query.page ?? 1 })
    const results = (data.results ?? [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r) => ({
        id: r.id,
        media_type: r.media_type,
        title: r.title ?? r.name,
        overview: r.overview,
        poster_path: r.poster_path,
        backdrop_path: r.backdrop_path,
        vote_average: r.vote_average,
        release_date: r.release_date ?? r.first_air_date,
      }))
    res.json({ results })
  } catch (e) {
    next(e)
  }
})

router.get('/trending', async (req, res, next) => {
  try {
    const data = await tmdb(`/trending/${req.query.type === 'tv' ? 'tv' : 'movie'}/week`)
    res.json({ results: data.results ?? [] })
  } catch (e) {
    next(e)
  }
})

router.get('/:type(movie|tv)/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'ID inválido.' })
    const data = await tmdb(`/${type}/${id}`, { append_to_response: 'credits,videos' })
    res.json(data)
  } catch (e) {
    next(e)
  }
})

router.get('/:type(movie|tv)/:id/season/:season', async (req, res, next) => {
  try {
    const { type, id, season } = req.params
    if (!/^\d+$/.test(id) || !/^\d+$/.test(season)) {
      return res.status(400).json({ error: 'Parâmetros inválidos.' })
    }
    const data = await tmdb(`/${type}/${id}/season/${season}`)
    res.json(data)
  } catch (e) {
    next(e)
  }
})

export { router as tmdbRouter }
