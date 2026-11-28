import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { randomUUID } from 'node:crypto'
import { bearer, resolveUser, accessState } from '../lib/entitlement.js'
import { supabaseAdmin } from '../lib/auth.js'
import {
  readProfiles,
  profileSummary,
  canCreateProfile,
  normalizeKind,
  limitsForPlan,
  isKidsContent,
} from '../lib/profiles.js'

/**
 * Perfis da conta — leitura e criação.
 *
 * ── POR QUE NO SERVIDOR ─────────────────────────────────────────────────────
 * O limite por plano é uma regra de negócio: se o navegador pudesse gravar a
 * lista de perfis, bastaria editar o `app_metadata` pelo SDK para ter 20
 * perfis no plano Básico. Aqui a lista vive em `app_metadata`, que só a Service
 * Role escreve, e a contagem é conferida ANTES de gravar.
 *
 * ── O QUE NÃO MUDA ──────────────────────────────────────────────────────────
 * Nenhuma tabela nova, nenhuma migração, nenhum dado apagado. A lista de
 * perfis é um array dentro do próprio usuário do Supabase Auth. Remover um
 * perfil só tira o item do array — favoritos e histórico continuam na conta.
 */

const router = Router()

const strict = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde um instante.' },
})

/** Plano vigente da conta, lido de `app_metadata` (fonte confiável). */
function planCodeOf(user) {
  const state = accessState(user)
  return state?.plan?.code ?? null
}

/** Carrega o usuário do Supabase Auth com a Service Role. */
async function loadUser(userId) {
  if (!supabaseAdmin) return { error: 'Servidor sem Service Role.', status: 503 }
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
  if (error || !data?.user) return { error: 'Conta não encontrada.', status: 404 }
  return { user: data.user }
}

/** Grava a lista de perfis e o perfil ativo em `app_metadata`. */
async function saveProfiles(userId, profiles, activeProfileId) {
  const { data: current, error: readErr } = await supabaseAdmin.auth.admin.getUserById(userId)
  if (readErr || !current?.user) return { error: 'Conta não encontrada.', status: 404 }

  const meta = { ...(current.user.app_metadata ?? {}) }
  meta.profiles = profiles
  if (activeProfileId !== undefined) meta.active_profile_id = activeProfileId

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { app_metadata: meta })
  if (error) return { error: error.message, status: 500 }
  return { ok: true }
}

/**
 * GET /api/profiles
 *
 * Devolve os perfis da conta, o resumo de limites do plano e o perfil ativo.
 * Sem sessão válida → 401. É a rota que a tela de perfis usa para saber se o
 * botão "Criar perfil" fica habilitado.
 */
router.get('/', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Entre na sua conta.' })

    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error })

    const user = resolved.user
    const meta = user.app_metadata ?? {}
    const profiles = readProfiles(meta)
    const planCode = planCodeOf(user)

    res.json({
      profiles,
      activeProfileId: meta.active_profile_id ?? null,
      ...profileSummary(planCode, profiles),
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/profiles
 * body: { name, kind?: 'adult' | 'kids' }
 *
 * Cria um perfil respeitando o limite do plano. O limite é conferido no
 * servidor com a lista ATUAL lida do banco — não com o que o cliente enviou.
 */
router.post('/', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Entre na sua conta.' })

    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error })

    const name = String(req.body?.name ?? '').trim()
    const kind = normalizeKind(req.body?.kind)

    if (name.length < 1) return res.status(400).json({ error: 'Informe o nome do perfil.' })
    if (name.length > 40) return res.status(400).json({ error: 'O nome do perfil deve ter até 40 caracteres.' })

    const loaded = await loadUser(resolved.user.id)
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error })

    const user = loaded.user
    const meta = user.app_metadata ?? {}
    const profiles = readProfiles(meta)
    const planCode = planCodeOf(user)

    const check = canCreateProfile(planCode, profiles, kind)
    if (!check.allowed) {
      return res.status(403).json({
        error: check.reason,
        limit: check.limit,
        used: check.used,
        kind: check.kind,
        ...profileSummary(planCode, profiles),
      })
    }

    const profile = {
      id: randomUUID(),
      name,
      kind,
      created_at: new Date().toISOString(),
    }
    const nextProfiles = [...profiles, profile]

    // O primeiro perfil criado vira o ativo — a conta nunca fica sem perfil.
    const activeProfileId = meta.active_profile_id ?? profile.id

    const saved = await saveProfiles(user.id, nextProfiles, activeProfileId)
    if (saved.error) return res.status(saved.status ?? 500).json({ error: saved.error })

    res.status(201).json({
      ok: true,
      profile,
      profiles: nextProfiles,
      activeProfileId,
      ...profileSummary(planCode, nextProfiles),
    })
  } catch (e) {
    next(e)
  }
})

/**
 * PUT /api/profiles/active
 * body: { profileId }
 *
 * Troca o perfil ativo. O id precisa existir na lista da própria conta — não
 * dá para "ativar" um perfil de outra pessoa.
 */
router.put('/active', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Entre na sua conta.' })

    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error })

    const profileId = String(req.body?.profileId ?? '').trim()
    const loaded = await loadUser(resolved.user.id)
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error })

    const profiles = readProfiles(loaded.user.app_metadata ?? {})
    const target = profiles.find((p) => p.id === profileId)
    if (!target) return res.status(404).json({ error: 'Perfil não encontrado nesta conta.' })

    const saved = await saveProfiles(loaded.user.id, profiles, target.id)
    if (saved.error) return res.status(saved.status ?? 500).json({ error: saved.error })

    res.json({ ok: true, activeProfileId: target.id, profile: target })
  } catch (e) {
    next(e)
  }
})

/**
 * DELETE /api/profiles/:id
 *
 * Remove um perfil da lista. Não apaga a conta, os favoritos nem o histórico —
 * só o item do array. O último perfil não pode ser removido: a conta precisa
 * de pelo menos um para entrar.
 */
router.delete('/:id', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Entre na sua conta.' })

    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error })

    const loaded = await loadUser(resolved.user.id)
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error })

    const user = loaded.user
    const meta = user.app_metadata ?? {}
    const profiles = readProfiles(meta)
    const target = profiles.find((p) => p.id === String(req.params.id))
    if (!target) return res.status(404).json({ error: 'Perfil não encontrado nesta conta.' })

    if (profiles.length <= 1) {
      return res.status(400).json({ error: 'A conta precisa de pelo menos um perfil.' })
    }

    const nextProfiles = profiles.filter((p) => p.id !== target.id)
    const activeProfileId =
      meta.active_profile_id === target.id ? nextProfiles[0].id : meta.active_profile_id

    const saved = await saveProfiles(user.id, nextProfiles, activeProfileId)
    if (saved.error) return res.status(saved.status ?? 500).json({ error: saved.error })

    const planCode = planCodeOf(user)
    res.json({
      ok: true,
      profiles: nextProfiles,
      activeProfileId,
      ...profileSummary(planCode, nextProfiles),
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/profiles/limits
 *
 * Só os limites do plano — usado pelo player e pelo catálogo para saber se o
 * perfil ativo é infantil, sem baixar a lista inteira.
 */
router.get('/limits', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Entre na sua conta.' })

    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error })

    const meta = resolved.user.app_metadata ?? {}
    const profiles = readProfiles(meta)
    const active = profiles.find((p) => p.id === meta.active_profile_id) ?? null
    const planCode = planCodeOf(resolved.user)

    res.json({
      plan: planCode,
      limits: limitsForPlan(planCode),
      activeProfile: active,
      kidsOnly: active?.kind === 'kids',
    })
  } catch (e) {
    next(e)
  }
})

export { router as profilesRouter, isKidsContent }
