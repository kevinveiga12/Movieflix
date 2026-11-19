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

/**
 * GET /api/catalog/posters?ids=603,1399&type=movie,tv
 *
 * Resolve a CAPA de vários títulos de uma vez, por `tmdb_id`.
 *
 * ── Por que esta rota existe ────────────────────────────────────────────────
 *
 * O app de TV mostra Histórico e Favoritos lendo as tabelas `favorites` e
 * `watch_history` do Supabase. A tabela `favorites` NÃO tem coluna
 * `poster_url` (schema real: id, user_id, media_type, title, tmdb_id,
 * created_at) e `watch_history` só a tem quando a linha foi gravada por uma
 * versão que já a enviava — linhas antigas ficam com string vazia. Resultado no
 * aparelho: card cinza, sem capa.
 *
 * A tentativa anterior era varrer o catálogo em páginas de 200 até achar o id.
 * Com 18.003 filmes e 8.088 séries isso nunca terminava (o laço parava em 2.000
 * itens), então a maioria das capas continuava vazia.
 *
 * Aqui a busca é O(1) por id, num índice em memória montado uma única vez a
 * partir do MESMO catálogo já parseado (`loadStatic`). É somente leitura, não
 * toca em banco, não muda nada do que o site faz — o site não chama esta rota.
 *
 * Resposta: { posters: { "603": "https://image.tmdb.org/..." }, missing: [ids] }
 */
router.get('/posters', async (req, res, next) => {
  try {
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .slice(0, 200)

    if (!ids.length) return res.json({ posters: {}, missing: [] })

    const index = await posterIndex()
    const posters = {}
    const missing = []
    for (const id of ids) {
      const url = index.get(id)
      if (url) posters[id] = url
      else missing.push(Number(id))
    }
    // Cache curto no cliente/CDN: capas não mudam de minuto em minuto.
    res.set('Cache-Control', 'public, max-age=300')
    res.json({ posters, missing })
  } catch (e) {
    next(e)
  }
})

/**
 * Índice `tmdb_id → poster_url` do catálogo inteiro.
 *
 * Montado uma vez e reaproveitado. Guarda só o que tem capa, para não gastar
 * memória com string vazia (o processo já vive apertado no plano Free).
 */
let posterIndexCache = null

async function posterIndex() {
  if (posterIndexCache) return posterIndexCache
  const [movies, series] = await Promise.all([loadBase('movie'), loadBase('tv')])
  const map = new Map()
  for (const t of [...movies, ...series]) {
    const id = String(t?.tmdb_id ?? '')
    const url = t?.poster_url
    if (id && typeof url === 'string' && url.startsWith('http')) map.set(id, url)
  }
  posterIndexCache = map
  return map
}

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
