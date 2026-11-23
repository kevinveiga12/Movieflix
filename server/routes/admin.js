import { Router } from 'express'
import { requireAdmin, supabaseAdmin } from '../lib/auth.js'
import {
  readOverrides,
  writeOverrides,
  readAdminConfig,
  writeAdminConfig,
  hideTitle,
  unhideTitle,
} from '../lib/store.js'
import { normalizeProfile } from '../lib/profile.js'
import { availabilityStats, loadStatic, loadRaw } from '../lib/static-catalog.js'
import { verifyTitles, probeTitle, EMBED_BASE } from '../lib/verify-embeds.js'
import { generateTrialCode, publicCodes, TRIAL_CODE_TTL_DAYS } from '../lib/trial-codes.js'

const router = Router()

// Todas as rotas exigem admin verificado no banco.
router.use(requireAdmin)

/* ──────────────────────────────────────────────────────────────────────────────
 * TÍTULOS OCULTOS — a ferramenta manual do painel
 *
 * POR QUE ESTA SEÇÃO EXISTE
 * A verificação automática cruza o nosso catálogo com o catálogo do provedor,
 * mas ela só sabe o que o provedor DECLARA ter. Título que o provedor lista e
 * mesmo assim abre a tela de erro ("Todas as fontes falharam") passa pela
 * verificação — foi o caso de "Visões de um Amor" (TMDB 1550338). Quem vê o
 * erro é o cliente, no aparelho dele; então o dono precisa de um botão.
 *
 * ONDE FICA GRAVADO
 * `server/data/catalog-overrides.json` → campo `hidden`. É o MESMO arquivo que
 * o painel já usava para editar metadados: nenhuma tabela nova, nenhuma
 * migração, nenhuma alteração no Supabase. Apagar o arquivo desfaz tudo.
 *
 * COMO VALE NO SITE, NA TV E NO APP
 * O filtro é aplicado na LEITURA, nos pontos que os três clientes usam:
 *   • /api/catalog/movies e /api/catalog/series  (listas, busca, categorias)
 *   • /api/catalog/availability                  (histórico e favoritos)
 *   • o catálogo estático que o navegador baixa  (home, destaques, relacionados)
 * Por isso ocultar aqui vale imediatamente, sem rebuild e sem reinstalar app.
 * ────────────────────────────────────────────────────────────────────────────── */

/** Normaliza para busca: minúsculas e sem acento. */
function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * GET /api/admin/hidden?q=visoes
 *
 * Lista os títulos ocultos. Sem `q`, devolve todos (mais recentes primeiro).
 * Com `q`, filtra por nome — a busca é feita sobre o `title` gravado no
 * momento de ocultar, então não precisa varrer o catálogo.
 */
router.get('/hidden', async (req, res, next) => {
  try {
    const overrides = await readOverrides()
    const q = fold(req.query.q ?? '').trim()
    const all = [...(overrides.hidden ?? [])].sort((a, b) =>
      String(b.em ?? '').localeCompare(String(a.em ?? '')),
    )
    const items = q
      ? all.filter((e) => fold(e.title).includes(q) || String(e.tmdb_id).includes(q))
      : all
    res.json({ total: all.length, items, updatedAt: overrides.updatedAt ?? null })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/admin/hidden/search?q=visoes&limit=30
 *
 * Busca no catálogo BRUTO (inclui o que já está oculto e o que está fora da
 * listagem pública) para o dono escolher o título a ocultar.
 *
 * Devolve só o necessário para a lista: id, tipo, nome, capa, ano e se já
 * está oculto. Não devolve sinopse nem elenco — a resposta precisa ser leve.
 */
router.get('/hidden/search', async (req, res, next) => {
  try {
    const q = fold(req.query.q ?? '').trim()
    if (q.length < 2) return res.json({ items: [], total: 0 })

    const limit = Math.min(Number(req.query.limit ?? 30) || 30, 60)
    const overrides = await readOverrides()
    const hiddenKeys = new Set((overrides.hidden ?? []).map((e) => `${e.type ?? '*'}:${e.tmdb_id}`))
    const isHidden = (id, type) => hiddenKeys.has(`${type}:${id}`) || hiddenKeys.has(`*:${id}`)

    const [movies, series] = await Promise.all([loadRaw('movie'), loadRaw('tv')])
    const terms = q.split(/\s+/).filter(Boolean)

    const scored = []
    for (const [list, type] of [
      [movies, 'movie'],
      [series, 'tv'],
    ]) {
      for (const t of list) {
        const name = fold(t.title)
        let score = 0
        let all = true
        for (const term of terms) {
          if (name.startsWith(term)) score += 100
          else if (name.includes(term)) score += 50
          else all = false
        }
        if (!all) continue
        score += (t.popularity ?? 0) / 1000
        scored.push({ t, type, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    const items = scored.slice(0, limit).map(({ t, type }) => ({
      tmdb_id: String(t.tmdb_id ?? t.id),
      type,
      title: t.title,
      poster_url: t.poster_url ?? '',
      year: t.year ?? '',
      category: t.category ?? '',
      hidden: isHidden(String(t.tmdb_id ?? t.id), type),
    }))

    res.json({ items, total: scored.length })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/admin/hidden
 * body: { tmdb_id, type: 'movie'|'tv', title?, poster_url?, motivo? }
 *
 * Oculta um título. Idempotente: ocultar de novo só atualiza o motivo.
 * Vale na hora para site, TV e app — o filtro é aplicado na leitura.
 */
router.post('/hidden', async (req, res, next) => {
  try {
    const tmdbId = String(req.body?.tmdb_id ?? '').trim()
    if (!/^\d+$/.test(tmdbId)) {
      return res.status(400).json({ error: 'Informe um tmdb_id numérico.' })
    }
    const rawType = String(req.body?.type ?? '').toLowerCase()
    if (rawType !== 'movie' && rawType !== 'tv' && rawType !== 'series') {
      return res.status(400).json({ error: 'Tipo inválido. Use "movie" ou "tv".' })
    }
    const type = rawType === 'movie' ? 'movie' : 'tv'

    // Nome e capa: usa o que o painel mandou; se não mandou, procura no
    // catálogo bruto para a lista de ocultos ficar legível.
    let title = String(req.body?.title ?? '').trim()
    let posterUrl = String(req.body?.poster_url ?? '').trim()
    if (!title || !posterUrl) {
      const list = await loadRaw(type === 'movie' ? 'movie' : 'tv')
      const found = list.find((t) => String(t.tmdb_id ?? t.id) === tmdbId)
      if (found) {
        title = title || found.title || ''
        posterUrl = posterUrl || found.poster_url || ''
      }
    }

    const saved = await hideTitle({
      tmdbId,
      type,
      title,
      posterUrl,
      motivo: req.body?.motivo ?? '',
      origem: 'manual',
    })

    res.status(201).json({
      ok: true,
      hidden: saved.hidden.length,
      item: saved.hidden.find((e) => e.tmdb_id === tmdbId && e.type === type) ?? null,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/admin/hidden/verify
 * body: { limit?: number, type?: 'movie'|'tv'|'all', dry_run?: boolean }
 *
 * Verifica a REPRODUÇÃO de verdade, no servidor, e oculta o que o provedor
 * responde como "sem fonte".
 *
 * ── Por que roda aqui e não no build ───────────────────────────────────────
 * O provedor está atrás do Cloudflare Turnstile e barra o ambiente de build
 * (403 em todos os domínios). O servidor de produção está em outro datacenter;
 * se ele também for barrado, a verificação devolve tudo como "incerto" e NÃO
 * oculta nada — nunca esconde título por falha de rede.
 *
 * ── O que conta como quebrado ──────────────────────────────────────────────
 * Só sinal positivo: "Movie or Episode Not Found", "Nenhuma fonte cadastrada",
 * "Todas as fontes falharam". 403/timeout/página vazia = incerto, fica de fora.
 *
 * `dry_run: true` só relata, sem gravar — é o modo seguro para conferir antes.
 */
router.post('/hidden/verify', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.body?.limit ?? 0) || 0, 5000)
    const type = String(req.body?.type ?? 'all')
    const dryRun = req.body?.dry_run === true

    const kinds = type === 'movie' ? ['movie'] : type === 'tv' ? ['tv'] : ['movie', 'tv']
    const lists = await Promise.all(kinds.map((k) => loadRaw(k === 'movie' ? 'movie' : 'tv')))

    let items = []
    for (let i = 0; i < kinds.length; i++) {
      for (const t of lists[i]) {
        const id = String(t.tmdb_id ?? t.id)
        if (!/^\d+$/.test(id)) continue
        items.push({
          tmdb_id: id,
          type: kinds[i],
          title: t.title ?? '',
          poster_url: t.poster_url ?? '',
        })
      }
    }
    if (limit) items = items.slice(0, limit)

    const results = await verifyTitles(items, { concurrency: 8 })
    const quebrados = results.filter((r) => r.status === 'quebrado')
    const ok = results.filter((r) => r.status === 'ok')
    const incertos = results.filter((r) => r.status === 'incerto')

    // Se NADA foi confirmado como funcional, o servidor provavelmente está
    // barrado pelo Cloudflare. Nesse caso não ocultamos nada: seria esconder o
    // catálogo inteiro por causa de um bloqueio de rede.
    const bloqueado = ok.length === 0 && incertos.length > 0

    let ocultados = 0
    if (!dryRun && !bloqueado) {
      for (const r of quebrados) {
        await hideTitle({
          tmdbId: r.tmdb_id,
          type: r.type,
          title: r.title,
          posterUrl: r.poster_url,
          motivo: 'verificação: provedor respondeu sem fonte',
          origem: 'verificacao',
        })
        ocultados++
      }
    }

    res.json({
      ok: true,
      dry_run: dryRun,
      bloqueado,
      verificado: results.length,
      funcionam: ok.length,
      quebrados: quebrados.length,
      incertos: incertos.length,
      ocultados,
      amostra_quebrados: quebrados.slice(0, 20).map((r) => ({
        tmdb_id: r.tmdb_id,
        type: r.type,
        title: r.title,
      })),
      aviso: bloqueado
        ? 'O servidor não conseguiu abrir o embed (provável bloqueio do Cloudflare). Nada foi ocultado.'
        : null,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/admin/hidden/diagnostico?ids=550,278,1550338
 *
 * Testa o provedor a partir do RUNTIME de produção e mostra o que cada título
 * respondeu. Serve para responder a pergunta que decide tudo: "o servidor
 * consegue abrir o embed, ou também está bloqueado?"
 *
 * Se todos vierem `incerto` com motivo de Cloudflare, a verificação automática
 * não é viável daqui e a ferramenta manual é o caminho — melhor saber isso do
 * que publicar uma verificação que nunca acha nada.
 */
router.get('/hidden/diagnostico', async (req, res, next) => {
  try {
    const ids = String(req.query.ids ?? '550,278,155,13,1550338')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .slice(0, 20)

    const resultados = await Promise.all(
      ids.map(async (id) => ({ tmdb_id: id, ...(await probeTitle(id)) })),
    )

    const algumOk = resultados.some((r) => r.status === 'ok')
    res.json({
      provedor: EMBED_BASE,
      acessivel: algumOk,
      resultados,
      conclusao: algumOk
        ? 'O servidor alcança o provedor: a verificação automática funciona.'
        : 'O servidor NÃO alcança o provedor (bloqueio do Cloudflare). Use a ferramenta manual.',
    })
  } catch (e) {
    next(e)
  }
})

/**
 * DELETE /api/admin/hidden/:type/:id — reexibe um título oculto.
 *
 * `type` aceita 'movie' e 'tv'. O título volta a aparecer em todas as listas
 * na próxima leitura — nada é recriado, porque nada foi apagado.
 */
router.delete('/hidden/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params
    if (type !== 'movie' && type !== 'tv') {
      return res.status(400).json({ error: 'Tipo inválido. Use "movie" ou "tv".' })
    }
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'ID inválido.' })

    const saved = await unhideTitle({ tmdbId: id, type })
    res.json({ ok: true, hidden: saved.hidden.length })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/admin/availability — situação do catálogo no provedor.
 *
 * O catálogo publicado tem 18.080 filmes e 8.093 séries; o EmbedMovies não
 * entrega todos. Este endpoint mostra quantos foram verificados como
 * disponíveis e quando foi a última verificação, para o admin saber se precisa
 * rodar `node scripts/validar-disponibilidade.cjs` de novo.
 */
router.get('/availability', async (_req, res, next) => {
  try {
    const [stats, movies, series] = await Promise.all([
      availabilityStats(),
      loadStatic('movie'),
      loadStatic('tv'),
    ])
    res.json({
      ...stats,
      // O que o site está exibindo agora (já filtrado pela disponibilidade).
      exibindo: { filmes: movies.length, series: series.length },
      provedor: 'embedmovies',
      comoAtualizar: 'node scripts/validar-disponibilidade.cjs',
    })
  } catch (e) {
    next(e)
  }
})

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
    // `select('*')` em vez de nomear colunas: os dois projetos Supabase do
    // histórico divergem (um tem `name`, o outro `full_name`). Nomear a coluna
    // errada devolve 42703 e derruba a lista inteira. normalizeProfile()
    // resolve o nome para o formato que o frontend espera.
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ users: (data ?? []).map(normalizeProfile) })
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

    // `hidden` aqui é o atalho do editor de metadados. Ele delega para as
    // mesmas funções da seção "Títulos ocultos", para existir UM só formato
    // de registro (com tipo, motivo e data) — antes gravava ID solto e o
    // título ficava oculto nos dois catálogos por engano.
    if (req.body.hidden === true) {
      const found = (await loadRaw(kind === 'movie' ? 'movie' : 'tv')).find(
        (t) => String(t.tmdb_id ?? t.id) === id,
      )
      await hideTitle({
        tmdbId: id,
        type: kind === 'movie' ? 'movie' : 'tv',
        title: found?.title ?? '',
        posterUrl: found?.poster_url ?? '',
        motivo: 'ocultado pelo editor de metadados',
        origem: 'manual',
      })
    } else if (req.body.hidden === false) {
      await unhideTitle({ tmdbId: id, type: kind === 'movie' ? 'movie' : 'tv' })
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
    // Desfazer as edições também reexibe o título — mas só no catálogo certo.
    await unhideTitle({ tmdbId: id, type: kind === 'movie' ? 'movie' : 'tv' })
    const saved = await writeOverrides(await readOverrides())
    res.json({ ok: true, overrides: saved })
  } catch (e) {
    next(e)
  }
})

/* ────────────────────────────────────────────────────────────────────────────
 * PLANOS — preço mensal, descontos de 3m/12m e ativação
 *
 * Grava em server/data/admin-config.json (ver store.js). A rota pública
 * /api/plans lê esse arquivo, então a alteração vale no site na hora, sem
 * migração de banco e sem rebuild.
 * ──────────────────────────────────────────────────────────────────────────── */

/** GET /api/admin/plans — configuração atual (padrões + o que o painel mudou) */
router.get('/plans', async (_req, res, next) => {
  try {
    const config = await readAdminConfig()
    res.json({ plans: config.plans ?? {}, updatedAt: config.updatedAt })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/admin/plans/:code
 * body: { price_cents?, discount_3m?, discount_12m?, is_active? }
 *
 * `discount_3m` / `discount_12m` são FRAÇÕES (0.2 = 20%). Aceitamos também
 * porcentagem inteira (20) e convertemos, porque é o que o painel mostra.
 */
router.put('/plans/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code ?? '').toLowerCase()
    if (!/^[a-z0-9_-]{2,32}$/.test(code)) {
      return res.status(400).json({ error: 'Código de plano inválido.' })
    }

    const patch = {}

    if (req.body.price_cents !== undefined) {
      const n = Number(req.body.price_cents)
      if (!Number.isFinite(n) || n < 0 || n > 10_000_00) {
        return res.status(400).json({ error: 'Preço inválido.' })
      }
      patch.price_cents = Math.round(n)
    }

    for (const key of ['discount_3m', 'discount_12m']) {
      if (req.body[key] === undefined) continue
      let n = Number(req.body[key])
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: `Desconto ${key} inválido.` })
      }
      // 20 → 0.2 ; 0.2 → 0.2
      if (n > 1) n = n / 100
      if (n > 0.9) return res.status(400).json({ error: 'Desconto máximo é 90%.' })
      patch[key] = Math.round(n * 1000) / 1000
    }

    if (req.body.is_active !== undefined) {
      patch.is_active = Boolean(req.body.is_active)
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nada para alterar.' })
    }

    const config = await readAdminConfig()
    config.plans = {
      ...(config.plans ?? {}),
      [code]: { ...(config.plans?.[code] ?? {}), ...patch },
    }
    const saved = await writeAdminConfig(config)
    res.json({ ok: true, code, plan: saved.plans[code], updatedAt: saved.updatedAt })
  } catch (e) {
    next(e)
  }
})

/* ────────────────────────────────────────────────────────────────────────────
 * USUÁRIOS — ativar/desativar acesso e conceder plano
 *
 * Tudo é gravado em `app_metadata` do Supabase Auth, com a Service Role. É a
 * fonte confiável: o usuário NÃO consegue editar app_metadata pelo SDK do
 * navegador (só user_metadata). O gate de reprodução lê exatamente daqui.
 * ──────────────────────────────────────────────────────────────────────────── */

const PLAN_DAYS = { '1m': 30, '3m': 90, '12m': 365 }

/**
 * Valida o id do usuário ANTES de chamar o SDK.
 *
 * O @supabase/auth-js recusa qualquer coisa que não seja UUID com
 * "Expected parameter to be UUID but is not", e sem esta checagem isso vira um
 * 500 genérico em vez de um 400 dizendo o que está errado.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validUserId(req, res) {
  if (!UUID_RE.test(String(req.params.id ?? ''))) {
    res.status(400).json({ error: 'ID de usuário inválido.' })
    return null
  }
  return req.params.id
}

/** GET /api/admin/users/:id/access — situação de acesso de um usuário */
router.get('/users/:id/access', async (req, res, next) => {
  try {
    const admin = supabaseAdmin
    if (!admin) return res.status(503).json({ error: 'Servidor sem Service Role.' })
    if (!validUserId(req, res)) return

    const { data, error } = await admin.auth.admin.getUserById(req.params.id)
    if (error || !data?.user) return res.status(404).json({ error: 'Usuário não encontrado.' })

    const meta = data.user.app_metadata ?? {}
    res.json({
      id: data.user.id,
      email: data.user.email ?? null,
      created_at: data.user.created_at ?? null,
      disabled: meta.access_disabled === true,
      plan_code: meta.plan_code ?? null,
      plan_expires_at: meta.plan_expires_at ?? null,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/admin/users/:id/access
 * body: { disabled?: boolean }
 *
 * Desativar grava `access_disabled: true` em app_metadata. O gate de
 * reprodução nega imediatamente — inclusive com plano pago vigente.
 */
router.put('/users/:id/access', async (req, res, next) => {
  try {
    const admin = supabaseAdmin
    if (!admin) return res.status(503).json({ error: 'Servidor sem Service Role.' })
    if (!validUserId(req, res)) return

    if (req.body.disabled === undefined) {
      return res.status(400).json({ error: 'Informe "disabled".' })
    }
    const disabled = Boolean(req.body.disabled)

    // Não permitir que o admin desative a própria conta por engano.
    if (disabled && req.user?.id === req.params.id) {
      return res.status(400).json({ error: 'Você não pode desativar a sua própria conta.' })
    }

    const { data: current, error: readErr } = await admin.auth.admin.getUserById(req.params.id)
    if (readErr || !current?.user) return res.status(404).json({ error: 'Usuário não encontrado.' })

    const meta = { ...(current.user.app_metadata ?? {}) }
    if (disabled) meta.access_disabled = true
    else delete meta.access_disabled

    const { data, error } = await admin.auth.admin.updateUserById(req.params.id, {
      app_metadata: meta,
    })
    if (error) return res.status(500).json({ error: error.message })

    res.json({
      ok: true,
      id: req.params.id,
      disabled: data.user.app_metadata?.access_disabled === true,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/admin/users/:id/plan
 * body: { plan_code: 'basico'|'standard'|'premium', period: '1m'|'3m'|'12m' }
 *
 * Grava `plan_code` e `plan_expires_at` em app_metadata. A validade é calculada
 * a partir de AGORA (ou do fim do plano atual, se ainda vigente — assim o
 * administrador não encurta um plano que o cliente já pagou).
 *
 * Isto é uma concessão MANUAL feita por um administrador autenticado. Não é
 * ativação automática por pagamento: o pedido proíbe ativar assinatura sem
 * confirmação confiável, e a confirmação aqui é a sessão de admin verificada
 * no banco + a ação explícita dele.
 */
router.post('/users/:id/plan', async (req, res, next) => {
  try {
    const admin = supabaseAdmin
    if (!admin) return res.status(503).json({ error: 'Servidor sem Service Role.' })
    if (!validUserId(req, res)) return

    const planCode = String(req.body.plan_code ?? '').toLowerCase()
    const period = String(req.body.period ?? '1m').toLowerCase()

    if (!['basico', 'standard', 'premium'].includes(planCode)) {
      return res.status(400).json({ error: 'Plano inválido. Use basico, standard ou premium.' })
    }
    if (!PLAN_DAYS[period]) {
      return res.status(400).json({ error: 'Período inválido. Use 1m, 3m ou 12m.' })
    }

    const { data: current, error: readErr } = await admin.auth.admin.getUserById(req.params.id)
    if (readErr || !current?.user) return res.status(404).json({ error: 'Usuário não encontrado.' })

    const meta = { ...(current.user.app_metadata ?? {}) }

    // Base do cálculo: o fim do plano atual, se ainda no futuro.
    const now = Date.now()
    const currentEnd = meta.plan_expires_at ? new Date(meta.plan_expires_at).getTime() : 0
    const base = Number.isFinite(currentEnd) && currentEnd > now ? currentEnd : now
    const expires = new Date(base + PLAN_DAYS[period] * 24 * 60 * 60 * 1000)

    meta.plan_code = planCode
    meta.plan_expires_at = expires.toISOString()
    // Conceder plano reativa a conta: não faz sentido dar plano a quem está
    // bloqueado e continuar bloqueado.
    delete meta.access_disabled

    const { data, error } = await admin.auth.admin.updateUserById(req.params.id, {
      app_metadata: meta,
    })
    if (error) return res.status(500).json({ error: error.message })

    res.json({
      ok: true,
      id: req.params.id,
      plan_code: data.user.app_metadata?.plan_code ?? null,
      plan_expires_at: data.user.app_metadata?.plan_expires_at ?? null,
      period,
      days: PLAN_DAYS[period],
    })
  } catch (e) {
    next(e)
  }
})

/* ────────────────────────────────────────────────────────────────────────────
 * CÓDIGO DE 1 MÊS GRÁTIS
 *
 * O mês grátis deixou de ser automático. O administrador gera um código de 6
 * dígitos para um cliente específico, passa o código para ele (WhatsApp) e o
 * cliente digita na aba de contas. A validação e a liberação acontecem no
 * servidor (POST /api/trial/redeem).
 *
 * O código em texto puro só existe na resposta desta rota — depois disso só o
 * hash fica guardado. Se o administrador perder o código, gera outro.
 * ──────────────────────────────────────────────────────────────────────────── */

/** POST /api/admin/users/:id/trial-code — gera um código para o cliente */
router.post('/users/:id/trial-code', async (req, res, next) => {
  try {
    if (!validUserId(req, res)) return

    const result = await generateTrialCode({
      userId: req.params.id,
      createdBy: req.user?.email ?? null,
    })

    if (!result.ok) {
      const status = result.reason === 'user_not_found' ? 404 : 503
      return res.status(status).json({
        error:
          result.reason === 'user_not_found'
            ? 'Usuário não encontrado.'
            : 'Não foi possível gerar o código agora.',
        reason: result.reason,
      })
    }

    res.status(201).json({
      ok: true,
      code: result.code,
      email: result.email,
      expiresAt: result.expiresAt,
      ttlDays: result.ttlDays,
      message: `Código gerado. Vale por ${result.ttlDays} dias e só pode ser usado uma vez.`,
    })
  } catch (e) {
    next(e)
  }
})

/** GET /api/admin/users/:id/trial-codes — histórico de códigos do cliente */
router.get('/users/:id/trial-codes', async (req, res, next) => {
  try {
    if (!validUserId(req, res)) return
    const admin = supabaseAdmin
    if (!admin) return res.status(503).json({ error: 'Servidor sem Service Role.' })

    const { data, error } = await admin.auth.admin.getUserById(req.params.id)
    if (error || !data?.user) return res.status(404).json({ error: 'Usuário não encontrado.' })

    res.json({
      email: data.user.email ?? null,
      ttlDays: TRIAL_CODE_TTL_DAYS,
      codes: publicCodes(data.user),
    })
  } catch (e) {
    next(e)
  }
})

export { router as adminRouter }
