/**
 * ROTAS DO MEGAEMBED.
 *
 * Tudo aqui é gated por `MEGAEMBED_ENABLED`. Com a flag desligada (padrão), as
 * rotas respondem 404 — o player continua no caminho atual, sem nenhuma
 * mudança de comportamento em produção.
 *
 *   GET /api/megaembed/status            → admin: estado da conexão + contagens
 *   GET /api/megaembed/sources/:type/:id → fontes de um título (filme/série)
 */
import { Router } from 'express'
import { requireAdmin } from '../lib/auth.js'
import {
  megaembedEnabled,
  resolveMegaEmbedSources,
  probeMegaEmbed,
  movieEmbedUrl,
  MEGAEMBED_BASE,
  STATES,
} from '../lib/megaembed.js'
import { readMegaEmbedReport } from '../lib/megaembed-report.js'

const router = Router()

/** Bloqueia tudo quando a integração está desligada. */
router.use((_req, res, next) => {
  if (!megaembedEnabled()) {
    return res.status(404).json({ error: 'Integração MegaEmbed desligada.' })
  }
  next()
})

/**
 * GET /api/megaembed/status — painel administrativo.
 *
 * Mostra o estado REAL da conexão: sonda o embed de um título conhecido e
 * devolve o que voltou. Não inventa "conectado" quando o Cloudflare bloqueia.
 */
router.get('/status', requireAdmin, async (_req, res, next) => {
  try {
    const report = await readMegaEmbedReport()
    const probe = await probeMegaEmbed(movieEmbedUrl(550))

    res.json({
      enabled: true,
      base: MEGAEMBED_BASE,
      // "conectado" só quando a sonda provou que a página tem player.
      connected: probe.state === STATES.AVAILABLE,
      probe: {
        state: probe.state,
        http: probe.http,
        hasPlayer: probe.hasPlayer,
        hasAds: probe.hasAds,
        challenge: probe.challenge,
        ms: probe.ms,
        error: probe.error ?? null,
      },
      catalogo: {
        filmes: report.movies ?? 0,
        series: report.series ?? 0,
        episodios: report.episodes ?? 0,
      },
      fontesIndisponiveis: report.unavailable ?? 0,
      ultimaAtualizacao: report.updatedAt ?? null,
      falhas: (report.failures ?? []).slice(0, 50),
      comoAtualizar: 'node scripts/validar-megaembed.mjs',
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/megaembed/sources/movie/:id
 * GET /api/megaembed/sources/tv/:id?season=1&episode=1
 */
router.get('/sources/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params
    const season = req.query.season != null ? Number(req.query.season) : null
    const episode = req.query.episode != null ? Number(req.query.episode) : null

    const sources = await resolveMegaEmbedSources({
      tmdbId: id,
      season: type === 'tv' ? season : null,
      episode: type === 'tv' ? episode : null,
    })

    if (!sources.length) {
      return res.status(400).json({ error: 'ID inválido para o MegaEmbed.' })
    }
    res.json({ sources })
  } catch (e) {
    next(e)
  }
})

export default router
