import { Router } from 'express'
import { readOverrides, applyOverrides } from '../lib/store.js'
import { loadStatic } from '../lib/static-catalog.js'

const router = Router()

/**
 * Catálogo estático (metadados do TMDB publicados em public/filmes/).
 *
 * O cache é ÚNICO e vive em lib/static-catalog.js — antes cada módulo tinha o
 * seu, e os 27 MB do catálogo eram parseados duas vezes, estourando a memória
 * do plano Free da Velixir.
 */
async function loadBase(kind) {
  return loadStatic(kind)
}

/** GET /api/catalog/movies?genre=&sort=&q=&limit=&offset= */
router.get('/movies', async (req, res, next) => {
  try {
    const overrides = await readOverrides()
    let list = applyOverrides(await loadBase('movie'), overrides, 'movie')
    list = filterAndSort(list, req.query)
    res.json({ total: list.length, items: paginate(list, req.query) })
  } catch (e) {
    next(e)
  }
})

router.get('/series', async (req, res, next) => {
  try {
    const overrides = await readOverrides()
    let list = applyOverrides(await loadBase('tv'), overrides, 'series')
    list = filterAndSort(list, req.query)
    res.json({ total: list.length, items: paginate(list, req.query) })
  } catch (e) {
    next(e)
  }
})

router.get('/genres', async (_req, res, next) => {
  try {
    const [movies, series] = await Promise.all([loadBase('movie'), loadBase('tv')])
    const set = new Set()
    for (const t of [...movies, ...series]) {
      if (!t.category) continue
      // Categorias vêm compostas ("Ação, Animação, Família") — separa em termos.
      for (const g of String(t.category).split(',')) {
        const clean = g.trim()
        if (clean) set.add(clean)
      }
    }
    res.json({ genres: [...set].sort((a, b) => a.localeCompare(b, 'pt-BR')) })
  } catch (e) {
    next(e)
  }
})

function filterAndSort(list, q) {
  let out = list
  if (q.genre && q.genre !== 'Todos') {
    // O catálogo guarda categorias compostas ("Ação, Animação, Família").
    // Compara por termo, não pela string inteira.
    const wanted = String(q.genre).toLowerCase()
    out = out.filter((t) =>
      String(t.category ?? '')
        .toLowerCase()
        .split(',')
        .map((s) => s.trim())
        .includes(wanted),
    )
  }
  if (q.q) {
    const needle = String(q.q).toLowerCase()
    out = out.filter((t) => String(t.title ?? '').toLowerCase().includes(needle))
  }
  const sort = q.sort ?? 'popular'
  const copy = [...out]
  switch (sort) {
    case 'recent':
      return copy.sort((a, b) => String(b.release_date ?? '').localeCompare(String(a.release_date ?? '')))
    case 'oldest':
      return copy.sort((a, b) => String(a.release_date ?? '').localeCompare(String(b.release_date ?? '')))
    case 'az':
      return copy.sort((a, b) => String(a.title).localeCompare(String(b.title), 'pt-BR'))
    case 'rating':
      return copy.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
    default:
      return copy.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
  }
}

function paginate(list, q) {
  const limit = Math.min(Number(q.limit ?? 60) || 60, 200)
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0)
  return list.slice(offset, offset + limit)
}

export { router as catalogRouter }
