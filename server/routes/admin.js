import { Router } from 'express'
import { requireAdmin, supabaseAdmin } from '../lib/auth.js'
import { readOverrides, writeOverrides, readAdminConfig, writeAdminConfig } from '../lib/store.js'
import { normalizeProfile } from '../lib/profile.js'
import { availabilityStats, loadStatic } from '../lib/static-catalog.js'
import { generateTrialCode, publicCodes, TRIAL_CODE_TTL_DAYS } from '../lib/trial-codes.js'

const router = Router()

// Todas as rotas exigem admin verificado no banco.
router.use(requireAdmin)

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
