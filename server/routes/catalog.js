import { Router } from 'express'
import { readOverrides, applyOverrides } from '../lib/store.js'
import { loadStatic, availabilityStats } from '../lib/static-catalog.js'
import { shuffleWithSeed } from '../lib/shuffle.js'
import { splitCategory, hasGenre } from '../lib/genres.js'

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

/**
 * GET /api/catalog/movies?genre=&sort=&q=&limit=&offset=&seed=
 *
 * `seed` é opcional e NÃO altera o contrato: sem ele a resposta é idêntica à
 * de antes (ordem por popularidade). Com ele, a ordem do topo é permutada de
 * forma determinística — a mesma semente devolve sempre a mesma sequência, o
 * que mantém a paginação coerente entre páginas e sessões.
 */
router.get('/movies', async (req, res, next) => {
  try {
    const overrides = await readOverrides()
    let list = applyOverrides(await loadBase('movie'), overrides, 'movie')
    list = applyVariety(filterAndSort(list, req.query), req.query.seed)
    res.json({ total: list.length, items: paginate(list, req.query) })
  } catch (e) {
    next(e)
  }
})

router.get('/series', async (req, res, next) => {
  try {
    const overrides = await readOverrides()
    let list = applyOverrides(await loadBase('tv'), overrides, 'series')
    list = applyVariety(filterAndSort(list, req.query), req.query.seed)
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

/**
 * GET /api/catalog/availability
 *
 * Lista os `tmdb_id` que o provedor realmente serve (verificado por
 * `scripts/gerar-disponibilidade-megaembed.mjs`). O catálogo já é servido
 * filtrado, mas os apps de TV e celular leem Favoritos e Histórico direto do
 * Supabase — linhas antigas podem apontar para títulos que hoje não abrem.
 * Com esta lista o app esconde esses cards, sem apagar nada do banco.
 *
 * Resposta: { ativo, gerado_em, filmes: [ids], series: [ids] }
 */
/**
 * GET /api/catalog/hidden
 *
 * Lista PÚBLICA (somente IDs) dos títulos ocultos pelo painel.
 *
 * ── Por que o navegador precisa disso ──────────────────────────────────────
 * A home, a busca e as categorias do site leem o catálogo direto de
 * `/filmes/*.json` (estático, com cache de 7 dias). O servidor filtra as rotas
 * `/api/catalog/*`, mas o JSON estático não passa por ele. Sem esta rota, um
 * título ocultado no painel continuaria aparecendo no site até o próximo build.
 *
 * Com ela, `src/lib/catalog.ts` baixa a lista e filtra no cliente: ocultar no
 * painel vale no site na hora, sem rebuild e sem reinstalar app.
 *
 * Resposta: { filmes: [ids], series: [ids], total }
 */
router.get('/hidden', async (_req, res, next) => {
  try {
    const overrides = await readOverrides()
    const filmes = []
    const series = []
    for (const entry of overrides.hidden ?? []) {
      const id = Number(entry.tmdb_id)
      if (!Number.isFinite(id)) continue
      // `type: null` = entrada antiga sem tipo: esconde nos dois catálogos.
      if (entry.type === 'movie' || entry.type === null) filmes.push(id)
      if (entry.type === 'tv' || entry.type === null) series.push(id)
    }
    res.set('Cache-Control', 'no-cache')
    res.json({ filmes, series, total: (overrides.hidden ?? []).length })
  } catch (e) {
    next(e)
  }
})

router.get('/availability', async (_req, res, next) => {
  try {
    const stats = await availabilityStats()
    const overrides = await readOverrides()
    // `loadStatic` já remove o que o provedor não serve; aqui removemos também
    // o que o dono ocultou no painel. É esta lista que o app de TV e o app de
    // celular usam para esconder Histórico e Favoritos — sem apagar nada do
    // banco, só deixando de exibir o card.
    const [movies, series] = await Promise.all([
      loadStatic('movie').then((l) => applyOverrides(l, overrides, 'movie')),
      loadStatic('tv').then((l) => applyOverrides(l, overrides, 'series')),
    ])
    res.set('Cache-Control', 'public, max-age=300')
    res.json({
      ativo: stats.active,
      gerado_em: stats.geradoEm,
      filmes: movies.map((t) => Number(t.tmdb_id)).filter((n) => Number.isFinite(n)),
      series: series.map((t) => Number(t.tmdb_id)).filter((n) => Number.isFinite(n)),
    })
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
      // `splitCategory` desdobra os compostos em inglês do TMDB
      // ("Action & Adventure" → Ação + Aventura) e esconde o duplicado.
      for (const g of splitCategory(t.category)) set.add(g)
    }
    res.json({ genres: [...set].sort((a, b) => a.localeCompare(b, 'pt-BR')) })
  } catch (e) {
    next(e)
  }
})

/**
 * Tamanho do "pool" que recebe a variação.
 *
 * A ordenação pedida (popular/recente/nota) continua sendo a base — o que muda
 * é a ordem DENTRO do topo. Embaralhar os 500 primeiros dá combinações
 * diferentes a cada acesso sem jogar um título obscuro na primeira fileira, e
 * como a permutação é determinística por semente a paginação continua coerente.
 *
 * O restante da lista segue na ordem original, então TODO título continua
 * alcançável descendo pelo catálogo — nada é removido nem escondido.
 */
const VARIETY_POOL = 500

/**
 * Aplica a variação por sessão sobre uma lista JÁ ordenada.
 *
 * Sem `seed` devolve a lista intacta (comportamento antigo, usado por quem não
 * pediu variedade — busca, painel administrativo, testes).
 */
function applyVariety(sorted, seed) {
  if (!seed || sorted.length < 2) return sorted
  const poolSize = Math.min(VARIETY_POOL, sorted.length)
  const pool = shuffleWithSeed(sorted.slice(0, poolSize), seed)
  return pool.concat(sorted.slice(poolSize))
}

function filterAndSort(list, q) {
  let out = list
  if (q.genre && q.genre !== 'Todos') {
    // O catálogo guarda categorias compostas ("Ação, Animação, Família").
    // Compara por termo, não pela string inteira — e desdobra os compostos
    // em inglês do TMDB, para "Ação" achar os títulos de "Action & Adventure".
    out = out.filter((t) => hasGenre(t.category, q.genre))
  }
  if (q.q) {
    const needle = String(q.q).toLowerCase()
    out = out.filter((t) => String(t.title ?? '').toLowerCase().includes(needle))
  }
  const sort = q.sort ?? 'popular'
  const copy = [...out]
  /*
    Datas ausentes vão SEMPRE para o fim.

    O catálogo tem títulos sem `release_date` (string vazia). Comparando como
    texto, `''` é menor que qualquer data — então "Mais antigos" abria com uma
    fileira de títulos SEM data, que não são os mais antigos de nada. Aqui a
    ausência é tratada como "desconhecida" e empurrada para o fim, nos dois
    sentidos.
  */
  const date = (t) => String(t.release_date ?? '')
  const byDate = (dir) => (a, b) => {
    const da = date(a)
    const db = date(b)
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return dir * da.localeCompare(db)
  }
  switch (sort) {
    case 'recent':
      return copy.sort(byDate(-1))
    case 'oldest':
      return copy.sort(byDate(1))
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
