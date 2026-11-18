import { Router } from 'express'
import { loadPlans } from '../lib/entitlement.js'
import { listMovies, seriesEpisodes, catalogStats, orphanSeasons } from '../lib/db-catalog.js'

/**
 * Catálogo administrado (Supabase).
 *
 * Convive com /api/catalog/* (o catálogo estático de metadados do TMDB, com
 * 18.080 filmes e 8.093 séries). A diferença é importante:
 *
 *   /api/catalog/*  -> metadados; a maioria NÃO tem vídeo próprio.
 *   /api/db/*       -> o que o administrador cadastrou e TEM fonte de vídeo.
 *
 * As páginas de reprodução usam /api/db/*, então nada aparece como "assistível"
 * sem source real no banco.
 */

const router = Router()

/** GET /api/db/movies?limit=&offset=&genre=&q= */
router.get('/movies', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 60) || 60, 200)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
    const result = await listMovies({
      limit,
      offset,
      genre: req.query.genre ? String(req.query.genre) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
    })
    if (result.unavailable) {
      return res.status(503).json({ error: 'Banco de dados não configurado no servidor.' })
    }
    if (result.error) return res.status(500).json({ error: result.error })
    res.json(result)
  } catch (e) {
    next(e)
  }
})

/** GET /api/db/series/:tmdbId/episodes */
router.get('/series/:tmdbId/episodes', async (req, res, next) => {
  try {
    const { tmdbId } = req.params
    if (!/^\d+$/.test(tmdbId)) return res.status(400).json({ error: 'tmdbId inválido.' })
    const result = await seriesEpisodes(Number(tmdbId))
    if (result.missing) {
      return res.status(404).json({ error: 'Série não encontrada no catálogo administrado.', seasons: [] })
    }
    res.json(result)
  } catch (e) {
    next(e)
  }
})

/** GET /api/db/stats — o que realmente existe para tocar. */
router.get('/stats', async (_req, res, next) => {
  try {
    const [stats, orphans] = await Promise.all([catalogStats(), orphanSeasons()])
    res.json({
      catalog: stats,
      orphanSeasons: orphans,
      note: orphans.length
        ? 'Há temporadas apontando para séries que não existem em movies. Elas não são exibidas.'
        : 'Todas as temporadas apontam para séries existentes.',
    })
  } catch (e) {
    next(e)
  }
})

export { router as dbCatalogRouter }
