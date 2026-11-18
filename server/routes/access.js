import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  authorizePlayback,
  bearer,
  loadSubscription,
  subscriptionActive,
  planLabel,
  resolveUser,
} from '../lib/entitlement.js'
import { findTitle, seriesEpisodes } from '../lib/db-catalog.js'

/**
 * Rotas de acesso ao conteúdo.
 *
 * /api/playback/authorize é a ÚNICA porta para liberar reprodução. O frontend
 * chama, recebe { allowed, url } e só então toca o vídeo. Como a decisão é
 * tomada no servidor com o token do usuário, esconder o botão no navegador não
 * é suficiente para contornar — e o cliente nunca vê a regra, só a resposta.
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

    const title = await findTitle(tmdbId)
    if (!title) {
      return res.status(404).json({
        allowed: false,
        reason: 'not_in_catalog',
        message: 'Este título não está no catálogo administrado e não pode ser reproduzido.',
      })
    }

    // 2) Série: resolve a URL do episódio pedido e valida que ele existe mesmo.
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
        message: 'Este título não tem fonte de reprodução autorizada cadastrada.',
      })
    }

    // 3) Assinatura + plano — sempre no servidor.
    const auth = await authorizePlayback({ token, requiredPlan: title.required_plan })
    if (!auth.allowed) {
      recordDenial({ tmdbId, reason: auth.reason, userId: auth.user?.id ?? null })
      return res.status(auth.status).json({
        allowed: false,
        reason: auth.reason,
        message: auth.message,
        subscription: auth.subscription
          ? {
              plan_code: auth.subscription.plan_code,
              status: auth.subscription.status,
              expires_at: auth.subscription.expires_at,
            }
          : null,
        requiredPlan: title.required_plan ?? null,
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
      plan: {
        code: auth.subscription?.plan_code ?? null,
        label: planLabel(auth.subscription?.plan_code),
        expires_at: auth.subscription?.expires_at ?? null,
      },
    })
  } catch (e) {
    next(e)
  }
})

/** GET /api/subscription — estado da assinatura do usuário logado. */
router.get('/subscription', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) {
      return res.status(401).json({ error: 'Token ausente.', subscription: null })
    }
    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error, subscription: null })

    const { subscription } = await loadSubscription(token, resolved.user.id)
    res.json({
      subscription: subscription
        ? {
            ...subscription,
            active: subscriptionActive(subscription),
            plan_label: planLabel(subscription.plan_code),
          }
        : null,
      active: subscriptionActive(subscription),
    })
  } catch (e) {
    next(e)
  }
})

export { router as accessRouter }
