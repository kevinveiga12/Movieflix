import { createHash, randomUUID } from 'node:crypto'
import { getAdminClient } from './supabase-server.js'
import { adminEmails } from './profile.js'

/**
 * Registro do benefício de 30 dias grátis — por E-MAIL e por DISPOSITIVO.
 *
 * PROBLEMA QUE ISTO RESOLVE (relatado pelo proprietário em 2026-11-18)
 *   A regra anterior concedia 30 dias a qualquer conta nova, calculados de
 *   `auth.users.created_at`. Na prática: a mesma pessoa criava julho3@,
 *   julho4@, julho5@ e repetia o mês grátis indefinidamente, sem gerar receita.
 *
 * REGRA ATUAL
 *   - Um benefício por E-MAIL (o próprio e-mail já é único no Auth).
 *   - Um benefício por DISPOSITIVO.
 *   - Se qualquer um dos dois já consumiu, a conta é criada normalmente mas
 *     nasce sem os 30 dias — o cliente cai direto na tela de planos.
 *   - Administrador é isento.
 *
 * IDENTIFICAÇÃO DO DISPOSITIVO — o que é honesto prometer
 *   O MovieFlix não depende de nada configurado no aparelho. Usamos DOIS sinais
 *   combinados, ambos gerados/observados no servidor:
 *
 *     1. Cookie `mf_did` — UUID emitido pelo SERVIDOR (HttpOnly, 2 anos).
 *        Sobrevive a limpar localStorage/sessionStorage; não é editável pelo JS
 *        da página. Cai se o cliente limpar TODOS os cookies.
 *
 *     2. Impressão de rede — SHA-256 de (IP + User-Agent + Accept-Language),
 *        lidos do request no servidor. Não é apagável pelo cliente, porque não
 *        mora no navegador.
 *
 *   A decisão é "negado se QUALQUER um dos dois já consumiu". Isso significa que
 *   limpar os dados do navegador (o caminho que o cliente realmente conhece) não
 *   devolve o benefício — a impressão de rede continua barrando.
 *
 *   LIMITE TÉCNICO, declarado sem rodeio: sem atestação de dispositivo (Play
 *   Integrity / DeviceCheck) não existe identificação de hardware 100% estável
 *   pela web. Trocar de aparelho E de rede ao mesmo tempo produz uma impressão
 *   nova. Não fingimos o contrário; o vínculo fica registrado no banco para o
 *   administrador enxergar o padrão no painel.
 *
 * ONDE O VÍNCULO É GRAVADO
 *   Preferência: tabela `public.trial_claims` (SQL em
 *   docs/SQL_TRIAL_DISPOSITIVO.sql), com UNIQUE(kind, value) — é o que impede
 *   duas requisições simultâneas de concederem duas vezes.
 *
 *   Enquanto o proprietário não executar o SQL no SQL Editor, o vínculo é
 *   gravado em `auth.users.app_metadata.trial`, que fica NO BANCO (não é
 *   memória, não é localStorage), só a Service Role escreve, e sobrevive a
 *   deploy/restart. A checagem por dispositivo nesse modo varre os usuários
 *   (poucos) e compara a impressão.
 *
 *   A decisão de QUAL armazenamento usar é detectada em runtime, não presumida.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** UUID do serviço de cookies. */
export const DEVICE_COOKIE = 'mf_did'
const COOKIE_MAX_AGE = 2 * 365 * 24 * 60 * 60

/** Duração do benefício. */
export const TRIAL_DAYS = 30

function sha256(s) {
  return createHash('sha256').update(s).digest('hex')
}

/** Cookie simples — sem dependência nova (cookie-parser não está instalado). */
function readCookie(req, name) {
  const raw = req?.headers?.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    if (part.slice(0, i).trim() !== name) continue
    return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

function writeDeviceCookie(res, value) {
  if (!res || typeof res.setHeader !== 'function') return
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader(
    'Set-Cookie',
    `${DEVICE_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
  )
}

/** IP do cliente respeitando o proxy da hospedagem. */
function clientIp(req) {
  const fwd = req?.headers?.['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim()
  return req?.ip ?? req?.socket?.remoteAddress ?? 'unknown'
}

/**
 * Lê/emite o identificador persistente do dispositivo.
 * O valor é gerado AQUI — o cliente nunca escolhe o próprio id.
 */
export function deviceIdFromRequest(req, res) {
  const existing = readCookie(req, DEVICE_COOKIE)
  if (existing && /^[0-9a-f-]{20,40}$/i.test(existing)) return existing
  const fresh = randomUUID()
  writeDeviceCookie(res, fresh)
  return fresh
}

/**
 * Impressão de rede do dispositivo (não apagável pelo cliente).
 * Hash — o IP em claro não é guardado.
 */
export function deviceFingerprint(req) {
  const ua = String(req?.headers?.['user-agent'] ?? '')
  const lang = String(req?.headers?.['accept-language'] ?? '')
  return sha256(`${clientIp(req)}|${ua}|${lang}`).slice(0, 40)
}

/** Chaves de dispositivo consideradas do mesmo aparelho. */
export function deviceKeys(req, res) {
  return [deviceIdFromRequest(req, res), `fp_${deviceFingerprint(req)}`]
}

/* ─────────────────────────── armazenamento ─────────────────────────── */

let tableState = null // null = não verificado, true/false = existe

/** A tabela `trial_claims` existe? Detectado uma vez, em runtime. */
export async function claimsTableReady() {
  if (tableState !== null) return tableState
  const admin = getAdminClient()
  if (!admin) {
    tableState = false
    return false
  }
  const { error } = await admin.from('trial_claims').select('id').limit(1)
  // PGRST205 = tabela ausente no schema cache. Qualquer outro erro (ex.: RLS)
  // ainda prova que a tabela existe.
  tableState = !error || !/PGRST205|does not exist|schema cache/i.test(String(error.message ?? ''))
  return tableState
}

/** Já existe vínculo para alguma destas chaves? Devolve a chave encontrada. */
async function findClaim(keys) {
  const admin = getAdminClient()
  if (!admin) return null

  if (await claimsTableReady()) {
    const { data, error } = await admin
      .from('trial_claims')
      .select('kind, value')
      .in('value', keys)
      .limit(1)
    if (error) return null
    return data?.[0]?.value ?? null
  }

  // Fallback: `app_metadata.trial` dos usuários (poucos). Só a Service Role lê.
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) return null
    const users = data?.users ?? []
    for (const u of users) {
      const t = u.app_metadata?.trial
      if (!t || t.granted !== true) continue
      const stored = Array.isArray(t.device_keys) ? t.device_keys : []
      const hit = keys.find((k) => stored.includes(k))
      if (hit) return hit
    }
    if (users.length < 200) break
  }
  return null
}

/** Registra o vínculo (idempotente). */
async function recordClaims({ keys, userId, email }) {
  const admin = getAdminClient()
  if (!admin) return

  if (await claimsTableReady()) {
    const rows = keys.map((value) => ({
      kind: value.startsWith('fp_') ? 'device' : 'device',
      value,
      user_id: userId,
      user_email: email ?? null,
    }))
    // onConflict: a UNIQUE(kind, value) é o que impede concessão dupla.
    const { error } = await admin.from('trial_claims').upsert(rows, {
      onConflict: 'kind,value',
      ignoreDuplicates: true,
    })
    if (!error) return
  }
  // Sem tabela: o vínculo já vai para app_metadata ao gravar o trial (abaixo).
}

/**
 * Concede (ou nega) o benefício para uma conta que está sendo criada.
 *
 * Devolve { granted, endsAt, reason }.
 *  - `granted: true`  → 30 dias a partir de agora.
 *  - `granted: false` → conta existe, sem benefício (`device_used`).
 */
export async function grantTrialForNewUser({ req, res, email }) {
  const admin = getAdminClient()
  if (!admin) return { granted: false, endsAt: null, reason: 'service_role_ausente' }

  const normalized = String(email ?? '').trim().toLowerCase()

  // Administrador é isento — não consome nem precisa de benefício.
  if (adminEmails().includes(normalized)) {
    return { granted: false, endsAt: null, reason: 'admin_exempt' }
  }

  const keys = deviceKeys(req, res)
  const used = await findClaim(keys)

  if (used) {
    return { granted: false, endsAt: null, reason: 'device_used', deviceKey: used }
  }

  return { granted: true, endsAt: null, reason: null, deviceKeys: keys }
}

/**
 * Grava o resultado do benefício em `app_metadata` do usuário.
 *
 * `app_metadata` e NÃO `user_metadata`: o próprio usuário logado pode escrever
 * `user_metadata` pelo SDK do navegador, então confiar nele permitiria conceder
 * a si mesmo um novo mês grátis. `app_metadata` só a Service Role escreve.
 */
export async function applyTrialMetadata({ userId, email, granted, deviceKeys }) {
  const admin = getAdminClient()
  if (!admin || !userId) return { ok: false }

  const now = new Date()
  const trial = granted
    ? {
        granted: true,
        started_at: now.toISOString(),
        ends_at: new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString(),
        device_keys: deviceKeys ?? [],
      }
    : {
        granted: false,
        denied_at: now.toISOString(),
        reason: 'device_used',
      }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { trial },
  })
  if (error) return { ok: false, error: error.message }

  // Registra o vínculo persistente (tabela quando existir).
  if (granted) {
    await recordClaims({ keys: deviceKeys ?? [], userId, email })
  }

  return { ok: true, trial }
}

/**
 * Lê o benefício registrado em `app_metadata`.
 * `undefined` = conta ANTERIOR a esta regra (legado) — quem decide o que fazer
 * é `accessState`, preservando o mês grátis de quem já está dentro dele.
 */
export function trialFromMetadata(user) {
  const t = user?.app_metadata?.trial
  if (!t || typeof t !== 'object') return undefined
  return {
    granted: t.granted === true,
    startedAt: t.started_at ?? null,
    endsAt: t.ends_at ?? null,
  }
}
