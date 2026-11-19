import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { authorizePlayback, bearer, resolveUser, accessState } from '../lib/entitlement.js'
import { findTitle, seriesEpisodes } from '../lib/db-catalog.js'
import {
  ensureProfile,
  confirmEmail,
  createConfirmedUser,
  confirmAllPendingEmails,
  countPendingEmails,
  findAdminUserByEmail,
  adminEmails,
} from '../lib/profile.js'
import { getAdminClient, getAnonClient, getClientAsUser } from '../lib/supabase-server.js'
import { applyTrialMetadata } from '../lib/trial-claims.js'
import { redeemTrialCode, TRIAL_CODE_MAX_ATTEMPTS } from '../lib/trial-codes.js'

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
        access: auth.access ?? null,
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
      plan: {
        code: auth.access?.plan?.code ?? null,
        label: auth.access?.reason === 'plan' ? 'Plano ativo' : 'Mês grátis',
        expires_at: auth.access?.plan?.expires_at ?? auth.access?.trialEndsAt ?? null,
      },
      access: auth.access ?? null,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/subscription — situação real de acesso da conta.
 *
 * Devolve o mês grátis (com a data em que termina) ou o plano pago vigente.
 * A decisão vem de `accessState`, que lê `created_at` do Auth e `app_metadata`
 * — nunca `user_metadata`.
 */
router.get('/subscription', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Token ausente.', subscription: null })
    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error, subscription: null })

    const state = accessState(resolved.user)
    res.json({
      subscription: state.plan
        ? {
            plan_code: state.plan.code,
            status: 'active',
            expires_at: state.plan.expires_at,
            plan_label: 'Plano ativo',
          }
        : null,
      active: state.allowed,
      access: state,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/trial/redeem
 * body: { code: '123456' }
 *
 * Libera 1 MÊS GRÁTIS com o código que o administrador gerou para ESTA conta.
 *
 * Por que a validação é aqui e não no navegador:
 *   O código é comparado com o hash guardado em `app_metadata` do próprio
 *   usuário — campo que só a Service Role escreve. Editar o frontend não
 *   libera nada: sem o código certo, o servidor não grava o benefício.
 *
 * O código é de uso único, vale 7 dias e o hash inclui o `userId`, então um
 * código gerado para outra pessoa não funciona aqui.
 */
const redeemLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
})

router.post('/trial/redeem', redeemLimiter, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Entre na sua conta para usar o código.' })

    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error })

    const code = String(req.body?.code ?? '').replace(/\D/g, '')
    if (code.length !== 6) {
      return res.status(400).json({ error: 'Digite os 6 números do código.' })
    }

    const result = await redeemTrialCode({ userId: resolved.user.id, code })

    if (result.ok) {
      return res.json({
        ok: true,
        granted: true,
        days: result.days,
        endsAt: result.endsAt,
        message: `Pronto! Seu mês grátis está liberado até ${new Date(result.endsAt).toLocaleDateString('pt-BR')}.`,
      })
    }

    // Mensagens em português, sem termo técnico, e sem revelar nada sobre
    // códigos de outras contas.
    const messages = {
      invalid: 'Código incorreto. Confira os 6 números e tente de novo.',
      used: 'Este código já foi utilizado. Peça um novo código pelo WhatsApp.',
      expired: 'Este código expirou. Peça um novo código pelo WhatsApp.',
      too_many_attempts: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
      already_active: 'Sua conta já tem um período grátis ou plano ativo.',
      user_not_found: 'Não encontramos sua conta. Saia e entre novamente.',
      service_role_ausente: 'Não foi possível validar o código agora. Tente em instantes.',
      write_failed: 'Não foi possível liberar o mês grátis agora. Tente em instantes.',
    }

    const status =
      result.reason === 'too_many_attempts'
        ? 429
        : result.reason === 'already_active'
          ? 409
          : result.reason === 'service_role_ausente' || result.reason === 'write_failed'
            ? 503
            : 400

    res.status(status).json({
      ok: false,
      error: messages[result.reason] ?? 'Não foi possível validar o código.',
      reason: result.reason,
      attemptsLeft: result.attemptsLeft ?? null,
      maxAttempts: TRIAL_CODE_MAX_ATTEMPTS,
    })
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

    /**
     * MÊS GRÁTIS — NÃO É MAIS AUTOMÁTICO.
     *
     * Regra definida pelo proprietário em 2026-11-18: ninguém recebe 30 dias ao
     * criar a conta. O benefício passou a ser liberado MANUALMENTE pelo
     * administrador, por um código de 6 dígitos que o cliente digita na aba de
     * contas (POST /api/trial/redeem).
     *
     * Motivo: contas em série (julho3@, julho4@, julho5@…) repetiam o mês
     * grátis indefinidamente. Com liberação manual, criar conta nova não gera
     * benefício nenhum.
     *
     * O que gravamos aqui é apenas a MARCA de que esta conta nasceu sob a nova
     * regra (`granted: false, reason: 'no_trial'`). Isso é o que impede o
     * cálculo legado por `created_at` de conceder 30 dias por engano — sem essa
     * marca, `accessState` cairia no fallback e daria o mês grátis.
     *
     * Contas ANTIGAS não têm essa marca e continuam com o benefício em curso
     * até o fim: ninguém perde o que já estava usando.
     *
     * Falha aqui NÃO derruba o cadastro — a conta já existe e o cliente precisa
     * conseguir entrar.
     */
    let trial = null
    try {
      const applied = await applyTrialMetadata({
        userId: result.user?.id,
        email,
        granted: false,
        reason: 'no_trial',
      })
      trial = applied.ok ? { granted: false, endsAt: null } : null
    } catch (e) {
      console.warn('[MovieFlix] marca de trial no cadastro:', e?.message ?? e)
    }

    res.status(201).json({
      ok: true,
      email,
      profile: result.profile,
      trial,
      message: 'Conta criada. Faça login para acessar o MovieFlix.',
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

/**
 * POST /api/auth/login
 * body: { email, password }
 *
 * Login feito no SERVIDOR para eliminar de vez o bloqueio por e-mail não
 * confirmado.
 *
 * Por que não usar o signInWithPassword do navegador: se a conta tiver sido
 * criada antes da correção (ou por qualquer outro caminho), ela fica com
 * `email_confirmed_at = null` e o Supabase devolve `email_not_confirmed`. O
 * usuário vê "Confirme seu e-mail antes de entrar" e não entra nunca, porque o
 * SMTP padrão do projeto não entrega a mensagem.
 *
 * Aqui: tentamos a senha no Supabase; se o erro for só falta de confirmação,
 * confirmamos pela API administrativa e repetimos — na mesma requisição, com a
 * MESMA senha e o MESMO id de usuário. A senha nunca é gravada nem logada.
 */
router.post('/auth/login', strict, async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')

    if (!email || !password) {
      return res.status(400).json({ error: 'Informe e-mail e senha.' })
    }

    const anon = getAnonClient()
    if (!anon) return res.status(503).json({ error: 'Supabase não configurado no servidor.' })

    const attempt = () =>
      anon.auth.signInWithPassword({ email, password })

    let { data, error } = await attempt()

    // Só um motivo justifica nova tentativa: falta de confirmação de e-mail.
    if (error && /email[ _]not[ _]confirmed|not confirmed/i.test(error.message ?? '')) {
      const found = await findAdminUserByEmail(email)
      if (found.user) {
        const admin = getAdminClient()
        await admin?.auth.admin.updateUserById(found.user.id, { email_confirm: true })
        ;({ data, error } = await attempt())
      }
    }

    if (error || !data?.session) {
      const msg = error?.message ?? 'Falha no login.'
      if (/invalid login credentials/i.test(msg)) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' })
      }
      if (/email[ _]not[ _]confirmed|not confirmed/i.test(msg)) {
        return res.status(403).json({
          error: 'Não foi possível liberar esta conta automaticamente. Fale com o suporte.',
        })
      }
      return res.status(401).json({ error: msg })
    }

    // Garante o perfil (e promove o administrador legítimo) antes de responder.
    const { profile } = await ensureProfile(data.session.user)

    res.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        expires_in: data.session.expires_in,
        token_type: data.session.token_type,
      },
      user: {
        id: data.session.user.id,
        email: data.session.user.email,
        email_confirmed: Boolean(data.session.user.email_confirmed_at),
      },
      profile,
      isAdmin: Boolean(profile?.is_admin),
    })
  } catch (e) {
    next(e)
  }
})

/* ────────────────────────────────────────────────────────────────────────────
 * Recuperação de senha por CÓDIGO de 6 dígitos
 *
 * O Supabase gera o código pela API administrativa (`generateLink` do tipo
 * `recovery`, campo `email_otp`). Nós o enviamos por e-mail e o usuário digita
 * no site. A validação é feita pelo PRÓPRIO Supabase (`verifyOtp`), então não
 * guardamos códigos em lugar nenhum e não há como forjar um.
 *
 * Validade, uso único e limite de tentativas vêm do Supabase (o OTP expira em
 * 1 hora e é consumido na primeira verificação bem-sucedida). Acima disso
 * aplicamos um contador em memória por e-mail para conter abuso barato.
 * ──────────────────────────────────────────────────────────────────────────── */

const CODE_TTL_MINUTES = 15
const MAX_CODE_ATTEMPTS = 5

/** e-mail -> { attempts, lastSentAt } — só para conter abuso; nunca guarda código. */
const codeThrottle = new Map()
/**
 * Teto do mapa de throttle.
 *
 * Sem isto, um ataque com e-mails aleatórios faria o Map crescer sem limite e
 * vazar memória no processo (o plano tem 256 MB). Ao encher, podamos as
 * entradas expiradas e, se ainda estiver cheio, descartamos a mais antiga.
 */
const CODE_THROTTLE_CAP = 500

function throttleFor(email) {
  const now = Date.now()
  let entry = codeThrottle.get(email)
  if (!entry || now - entry.lastSentAt > CODE_TTL_MINUTES * 60_000) {
    if (codeThrottle.size >= CODE_THROTTLE_CAP) {
      for (const [k, v] of codeThrottle) {
        if (now - v.lastSentAt > CODE_TTL_MINUTES * 60_000) codeThrottle.delete(k)
      }
      if (codeThrottle.size >= CODE_THROTTLE_CAP) {
        const oldest = codeThrottle.keys().next().value
        if (oldest !== undefined) codeThrottle.delete(oldest)
      }
    }
    entry = { attempts: 0, lastSentAt: 0 }
    codeThrottle.set(email, entry)
  }
  return entry
}

/**
 * Envia o código. Usa Resend (HTTP) se houver RESEND_API_KEY; senão SMTP via
 * nodemailer. Sem nenhum dos dois devolve `not_configured` — nunca finge envio.
 */
async function sendCodeEmail({ to, code }) {
  const subject = `MovieFlix — seu código de recuperação: ${code}`
  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px;background:#0b0b0f;color:#f5f5f7;border-radius:14px">
      <h2 style="margin:0 0 6px;font-size:20px">MovieFlix</h2>
      <p style="color:#a1a1aa;margin:0 0 22px">Recuperação de senha</p>
      <p>Use o código abaixo para criar uma nova senha:</p>
      <p style="font-size:34px;letter-spacing:10px;font-weight:700;margin:22px 0;color:#fff">${code}</p>
      <p style="color:#a1a1aa;font-size:13px">O código vale por ${CODE_TTL_MINUTES} minutos e só pode ser usado uma vez.
      Se você não pediu a troca, ignore este e-mail — sua senha continua a mesma.</p>
    </div>`

  const resendKey = process.env.RESEND_API_KEY
  if (resendKey) {
    const from = process.env.MAIL_FROM ?? 'MovieFlix <onboarding@resend.dev>'
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return { ok: false, provider: 'resend', error: `HTTP ${r.status} ${detail.slice(0, 200)}` }
    }
    return { ok: true, provider: 'resend', error: null }
  }

  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (host && user && pass) {
    let nodemailer
    try {
      nodemailer = (await import('nodemailer')).default
    } catch {
      return { ok: false, provider: 'smtp', error: 'nodemailer não instalado' }
    }
    const port = Number(process.env.SMTP_PORT ?? 587)
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    })
    try {
      await transport.sendMail({
        from: process.env.MAIL_FROM ?? user,
        to,
        subject,
        html,
      })
      return { ok: true, provider: 'smtp', error: null }
    } catch (e) {
      return { ok: false, provider: 'smtp', error: String(e?.message ?? e).slice(0, 200) }
    }
  }

  return { ok: false, provider: null, error: 'not_configured' }
}

/**
 * POST /api/auth/request-code
 * body: { email }
 *
 * Responde sempre 200 com a mesma mensagem, exista ou não a conta — não
 * revelamos quais e-mails estão cadastrados. Só devolve erro explícito quando o
 * problema é de infraestrutura (SMTP ausente), porque nesse caso esconder não
 * ajuda ninguém.
 */
router.post('/auth/request-code', strict, async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'E-mail inválido.' })
    }

    const entry = throttleFor(email)
    // No máximo 1 código por minuto por e-mail.
    if (Date.now() - entry.lastSentAt < 60_000) {
      return res.status(429).json({
        error: 'Aguarde um minuto antes de pedir outro código.',
      })
    }

    const admin = getAdminClient()
    if (!admin) return res.status(503).json({ error: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY.' })

    const found = await findAdminUserByEmail(email)
    if (found.error) return res.status(503).json({ error: 'Não foi possível consultar a conta.' })

    // Conta inexistente: resposta neutra, sem gerar código.
    if (!found.user) {
      entry.lastSentAt = Date.now()
      return res.json({
        ok: true,
        sent: false,
        message: 'Se este e-mail estiver cadastrado, o código será enviado.',
      })
    }

    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    })
    if (error) return res.status(503).json({ error: 'Não foi possível gerar o código.' })

    const code = data?.properties?.email_otp
    if (!code) {
      return res.status(503).json({
        error: 'O projeto Supabase não devolveu um código de recuperação.',
      })
    }

    const sent = await sendCodeEmail({ to: email, code })
    if (!sent.ok) {
      if (sent.error === 'not_configured') {
        return res.status(503).json({
          error:
            'O envio de e-mail não está configurado no servidor. Cadastre RESEND_API_KEY (ou SMTP_HOST/SMTP_USER/SMTP_PASS) nas variáveis de ambiente.',
          missing: 'email_provider',
        })
      }
      return res.status(502).json({ error: `Falha ao enviar o e-mail (${sent.provider}).` })
    }

    entry.lastSentAt = Date.now()
    entry.attempts = 0

    res.json({
      ok: true,
      sent: true,
      expiresInMinutes: CODE_TTL_MINUTES,
      message: 'Código enviado para o seu e-mail.',
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /api/auth/verify-code
 * body: { email, code, password }
 *
 * Verifica o código no Supabase (`verifyOtp`, tipo `recovery`) e, com a sessão
 * resultante, grava a nova senha da própria conta. Não usa a Service Role para
 * trocar a senha: quem troca é o token que o código gerou.
 */
router.post('/auth/verify-code', strict, async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const code = String(req.body?.code ?? '').replace(/\D/g, '')
    const password = String(req.body?.password ?? '')

    if (!email || code.length !== 6) {
      return res.status(400).json({ error: 'Informe o e-mail e o código de 6 dígitos.' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' })
    }

    const entry = throttleFor(email)
    if (entry.attempts >= MAX_CODE_ATTEMPTS) {
      return res.status(429).json({
        error: 'Muitas tentativas com este e-mail. Peça um novo código em alguns minutos.',
      })
    }

    const anon = getAnonClient()
    if (!anon) return res.status(503).json({ error: 'Supabase não configurado no servidor.' })

    const { data, error } = await anon.auth.verifyOtp({ email, token: code, type: 'recovery' })

    if (error || !data?.session) {
      entry.attempts += 1
      const restantes = Math.max(0, MAX_CODE_ATTEMPTS - entry.attempts)
      return res.status(400).json({
        error:
          restantes > 0
            ? `Código inválido ou expirado. Tentativas restantes: ${restantes}.`
            : 'Código inválido. Peça um novo código.',
        attemptsLeft: restantes,
      })
    }

    // Sessão legítima emitida pelo código: troca a senha com ela.
    const userClient = getClientAsUser(data.session.access_token)
    const { error: updErr } = await userClient.auth.updateUser({ password })
    if (updErr) {
      return res.status(400).json({ error: updErr.message })
    }

    entry.attempts = 0
    entry.lastSentAt = 0

    res.json({ ok: true, message: 'Senha atualizada. Você já pode entrar.' })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/auth/pending  — quantas contas seguem sem e-mail confirmado.
 * POST /api/auth/activate-all — confirma todas (restringido ao administrador).
 */
router.get('/auth/pending', strict, async (_req, res, next) => {
  try {
    const counts = await countPendingEmails()
    if (counts.error) return res.status(503).json({ error: counts.error })
    res.json(counts)
  } catch (e) {
    next(e)
  }
})

router.post('/auth/activate-all', strict, async (req, res, next) => {
  try {
    const token = bearer(req)
    if (!token) return res.status(401).json({ error: 'Token ausente.' })

    const resolved = await resolveUser(token)
    if (resolved.error) return res.status(401).json({ error: resolved.error })

    const email = String(resolved.user.email ?? '').toLowerCase()
    if (!adminEmails().includes(email)) {
      return res.status(403).json({ error: 'Apenas o administrador pode liberar as contas.' })
    }

    const result = await confirmAllPendingEmails()
    if (result.error) return res.status(503).json({ error: result.error })

    // O administrador também entra em `profiles` como admin.
    await ensureProfile(resolved.user)

    res.json({ ok: true, ...result })
  } catch (e) {
    next(e)
  }
})

export { router as accessRouter }
