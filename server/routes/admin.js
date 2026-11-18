import { Router } from 'express'
import { requireAdmin, supabaseAdmin } from '../lib/auth.js'
import { readOverrides, writeOverrides } from '../lib/store.js'

const router = Router()

// Todas as rotas exigem admin verificado no banco.
router.use(requireAdmin)

/** GET /api/admin/stats — números do painel */
router.get('/stats', async (_req, res, next) => {
  try {
    const [users, favorites, history] = await Promise.all([
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('favorites').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('watch_history').select('id', { count: 'exact', head: true }),
    ])
    const overrides = await readOverrides()
    res.json({
      users: users.count ?? 0,
      favorites: favorites.count ?? 0,
      history: history.count ?? 0,
      editedMovies: Object.keys(overrides.movies ?? {}).length,
      editedSeries: Object.keys(overrides.series ?? {}).length,
      hidden: (overrides.hidden ?? []).length,
      updatedAt: overrides.updatedAt,
    })
  } catch (e) {
    next(e)
  }
})

/** GET /api/admin/users — lista usuários (sem dados sensíveis) */
router.get('/users', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200)
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, name, is_admin, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ users: data ?? [] })
  } catch (e) {
    next(e)
  }
})

/** GET /api/admin/overrides — edições atuais */
router.get('/overrides', async (_req, res, next) => {
  try {
    res.json(await readOverrides())
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/admin/overrides/:kind/:id
 * body: { title?, description?, poster_url?, backdrop_url?, video_url?, quality?, category?, hidden? }
 */
router.put('/overrides/:kind/:id', async (req, res, next) => {
  try {
    const { kind, id } = req.params
    if (kind !== 'movie' && kind !== 'series') {
      return res.status(400).json({ error: 'Tipo inválido. Use "movie" ou "series".' })
    }
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'ID inválido.' })

    const allowed = [
      'title',
      'description',
      'poster_url',
      'backdrop_url',
      'video_url',
      'quality',
      'category',
      'language',
      'year',
    ]
    const patch = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const v = req.body[key]
        if (typeof v !== 'string') return res.status(400).json({ error: `Campo ${key} inválido.` })
        if (v.length > 2000) return res.status(400).json({ error: `Campo ${key} muito longo.` })
        patch[key] = v.trim()
      }
    }

    // Valida URL de vídeo: só http(s) — evita javascript: e afins.
    if (patch.video_url && !/^https?:\/\//i.test(patch.video_url)) {
      return res.status(400).json({ error: 'A URL de vídeo deve começar com http:// ou https://' })
    }
    for (const key of ['poster_url', 'backdrop_url']) {
      if (patch[key] && !/^https?:\/\//i.test(patch[key])) {
        return res.status(400).json({ error: `${key} deve ser uma URL http(s).` })
      }
    }

    const overrides = await readOverrides()
    const bucket = kind === 'movie' ? 'movies' : 'series'
    overrides[bucket] = { ...(overrides[bucket] ?? {}), [id]: { ...(overrides[bucket]?.[id] ?? {}), ...patch } }

    if (req.body.hidden === true) {
      const set = new Set(overrides.hidden ?? [])
      set.add(id)
      overrides.hidden = [...set]
    } else if (req.body.hidden === false) {
      overrides.hidden = (overrides.hidden ?? []).filter((x) => x !== id)
    }

    const saved = await writeOverrides(overrides)
    res.json({ ok: true, overrides: saved })
  } catch (e) {
    next(e)
  }
})

/** DELETE /api/admin/overrides/:kind/:id — desfaz edições de um título */
router.delete('/overrides/:kind/:id', async (req, res, next) => {
  try {
    const { kind, id } = req.params
    if (kind !== 'movie' && kind !== 'series') {
      return res.status(400).json({ error: 'Tipo inválido.' })
    }
    const overrides = await readOverrides()
    const bucket = kind === 'movie' ? 'movies' : 'series'
    if (overrides[bucket]) delete overrides[bucket][id]
    overrides.hidden = (overrides.hidden ?? []).filter((x) => x !== id)
    const saved = await writeOverrides(overrides)
    res.json({ ok: true, overrides: saved })
  } catch (e) {
    next(e)
  }
})

export { router as adminRouter }
