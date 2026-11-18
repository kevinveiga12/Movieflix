import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { authorizePlayback, bearer, resolveUser } from '../lib/entitlement.js'
import { findTitle, seriesEpisodes } from '../lib/db-catalog.js'
import { ensureProfile, confirmEmail, createConfirmedUser } from '../lib/profile.js'

/**
 * Rotas de acesso ao conteúdo.
 *
 * /api/playback/authorize é a ÚNICA porta para liberar reprodução. O frontend
 * chama, recebe { allowed, url } e só então toca o vídeo. Como a decisão é
 * tomada no servidor com o token do usuário, esconder o botão no navegador não
 * é suficiente para contornar — e o cliente nunca vê a regra, só a resposta.
 *
 * REGRA ATUAL: o MovieFlix 2.0 é gratuito. Basta estar autenticado.
 */

const router = Router()

const strict = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde um instante.' },
})

/**
 * Log de acesso negado — sem dados sensíveis.
 * Guardado em memória para o painel poder mostrar "tentativas bloqueadas",
 * sem gravar nada no banco do proprietário.
 */
const denials = []
const DENIAL_CAP = 200

function recordDenial(entry) {
  denials.unshift({ ...entry, at: new Date().toISOString() })
  if (denials.length > DENIAL_CAP) denials.length = DENIAL_CAP
}

export function recentDenials() {
  return denials
}

/**
 * POST /api/playback/authorize
 * body: { tmdbId: number, season?: number, episode?: number }
 */
router.post('/playback/authorize', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    const tmdbId = Number(req.body?.tmdbId)
    const season = req.body?.season != null ? Number(req.body.season) : null
    const episode = req.body?.episode != null ? Number(req.body.episode) : null

    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return res.status(400).json({ allowed: false, reason: 'bad_request', message: 'tmdbId inválido.' })
    }

    // 1) Sem token: nem checa o título (não vaza existência de conteúdo).
    if (!token) {
      recordDenial({ tmdbId, reason: 'unauthenticated' })
      return res.status(401).json({
        allowed: false,
        reason: 'unauthenticated',
        message: 'Crie sua conta ou entre para assistir.',
      })
    }

    // 2) Autenticação — validada no servidor, sempre.
    const auth = await authorizePlayback({ token })
    if (!auth.allowed) {
      recordDenial({ tmdbId, reason: auth.reason })
      return res.status(auth.status).json({
        allowed: false,
        reason: auth.reason,
        message: auth.message,
      })
    }

    // 3) O título precisa existir no catálogo (banco ou estático).
    const title = await findTitle(tmdbId)
    if (!title) {
      return res.status(404).json({
        allowed: false,
        reason: 'not_in_catalog',
        message: 'Este título não está no catálogo e não pode ser reproduzido.',
      })
    }

    // 4) Série: resolve a URL do episódio pedido e valida que ele existe mesmo.
    let sourceUrl = title.video_url
    let sourceLabel = null

    if (title.type === 'tv' || season != null) {
      if (season == null || episode == null) {
        return res.status(400).json({
          allowed: false,
          reason: 'episode_required',
          message: 'Informe temporada e episódio.',
        })
      }
      const { seasons } = await seriesEpisodes(tmdbId)
      const s = seasons.find((x) => x.season_number === season)
      const ep = s?.episodes?.find((x) => x.episode_number === episode)
      if (!ep?.video_url) {
        return res.status(404).json({
          allowed: false,
          reason: 'episode_not_found',
          message: `O episódio T${season} E${episode} não está disponível.`,
        })
      }
      sourceUrl = ep.video_url
      sourceLabel = `T${season} E${episode}`
    }

    if (!sourceUrl) {
      return res.status(404).json({
        allowed: false,
        reason: 'no_source',
        message: 'Este título não tem fonte de reprodução cadastrada.',
      })
    }

    recordDenial({ tmdbId, reason: 'allowed', userId: auth.user.id })

    res.json({
      allowed: true,
      title: { tmdb_id: title.tmdb_id, title: title.title, quality: title.quality },
      source: {
        url: sourceUrl,
        label: sourceLabel,
        // Só é arquivo reproduzível se for extensão de mídia.
        mode: /\.(mp4|m4v|webm|m3u8|mpd)(\?|#|$)/i.test(sourceUrl) ? 'direct' : 'embed',
      },
      plan: { code: null, label: 'Acesso gratuito', expires_at: null },
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/subscription — mantido por compatibilidade.
 * A plataforma é gratuita: sempre devolve acesso liberado para quem está logado.
 */
router.get('/subscription', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Token ausente.', subscription: null })
    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error, subscription: null })
    res.json({ subscription: null, active: true, free: true })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/auth/signup
 * body: { email, password, fullName? }
 *
 * Cria a conta com o e-mail JÁ CONFIRMADO e o perfil na sequência.
 *
 * O signUp do navegador não serve aqui: com "Confirm email" ligado e o SMTP
 * padrão do Supabase, o usuário se cadastra e nunca consegue entrar (login
 * devolve `email_not_confirmed`). Verificado em 2026-11-18.
 *
 * A senha nunca é gravada nem logada — vai direto para o Supabase Auth.
 */
router.post('/auth/signup', strict, async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    const fullName = String(req.body?.fullName ?? '').trim()

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'E-mail inválido.' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' })
    }

    const result = await createConfirmedUser({ email, password, fullName })
    if (result.error) {
      return res.status(result.status ?? 400).json({ error: result.error })
    }

    res.status(201).json({
      ok: true,
      email,
      profile: result.profile,
      message: 'Conta criada. Faça login para assistir.',
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/profile/ensure
 *
 * Cria (ou completa) a linha em `profiles` do usuário autenticado.
 *
 * Por que existe: o banco NÃO tem trigger de criação de perfil — verificado em
 * 2026-11-18, usuário novo no Auth fica sem linha em `profiles`, e o painel
 * administrativo não reconhece ninguém. O cliente não consegue inserir sozinho
 * sem esbarrar na RLS, então o servidor faz com a Service Role.
 *
 * `is_admin` NUNCA vem do corpo da requisição: só é concedido quando o e-mail
 * está em ADMIN_EMAILS.
 */
router.post('/profile/ensure', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Token ausente.' })

    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error })

    const { profile, created, error } = await ensureProfile(resolved.user)
    if (error) {
      return res.status(503).json({
        error: 'Não foi possível preparar o perfil.',
        detail: error,
        profile: null,
      })
    }
    res.json({ profile, created })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/profile/confirm-email
 *
 * Confirma o e-mail do usuário recém-cadastrado.
 *
 * O projeto está com "Confirm email" ligado e o SMTP padrão do Supabase não
 * entrega para destinatários arbitrários — na prática ninguém consegue entrar
 * depois de se cadastrar (verificado: login devolve `email_not_confirmed`).
 * O MovieFlix não exige verificação de e-mail para assistir, então o servidor
 * confirma no momento do cadastro.
 */
router.post('/profile/confirm-email', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Token ausente.' })

    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error })

    const { ok, error } = await confirmEmail(resolved.user.id)
    if (!ok) return res.status(503).json({ confirmed: false, error })
    res.json({ confirmed: true })
  } catch (e) {
    next(e)
  }
})

export { router as accessRouter }
