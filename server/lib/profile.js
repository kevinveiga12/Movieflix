import { getAdminClient, hasServiceRole } from './supabase-server.js'

/**
 * Perfis de usuário — leitura e criação tolerantes ao schema.
 *
 * PROBLEMA QUE ISTO RESOLVE (verificado em 2026-11-18)
 * Os dois projetos Supabase usados no histórico têm schemas DIFERENTES para a
 * coluna de nome:
 *
 *   mntyanfhxiqspdedmddb -> profiles.name
 *   zhsfqptngzgbcgiwwjug -> profiles.full_name   (name NÃO existe: erro 42703)
 *
 * O código anterior consultava `name` fixo. No projeto atual isso devolve
 * 42703, o perfil nunca carrega e o painel administrativo não reconhece
 * ninguém — foi a causa de "zero perfis" mesmo com usuários no Auth.
 *
 * SOLUÇÃO
 * Em vez de fixar a coluna, descobrimos qual existe (uma vez, em cache) e
 * normalizamos a linha para o formato que o frontend espera (`name`). Nenhuma
 * migração, nenhuma coluna criada, nenhum dado alterado.
 */

const CANDIDATES = ['name', 'full_name', 'display_name']

let nameColumn = null
let detected = false

/** Descobre qual coluna de nome existe em `profiles`. Cacheado. */
export async function detectNameColumn() {
  if (detected) return nameColumn
  const admin = getAdminClient()
  if (!admin) {
    detected = true
    return null
  }
  for (const col of CANDIDATES) {
    const { error } = await admin.from('profiles').select(col).limit(1)
    if (!error) {
      nameColumn = col
      detected = true
      return col
    }
  }
  detected = true
  return null
}

/** Normaliza uma linha de `profiles` para o formato do frontend. */
export function normalizeProfile(row) {
  if (!row) return null
  const name = row.name ?? row.full_name ?? row.display_name ?? null
  return {
    id: row.id,
    email: row.email ?? null,
    name,
    avatar_url: row.avatar_url ?? null,
    is_admin: Boolean(row.is_admin),
    created_at: row.created_at ?? null,
  }
}

/**
 * E-mails com permissão administrativa.
 *
 * O proprietário do projeto é administrador por definição. ADMIN_EMAILS pode
 * acrescentar outros; se a variável não existir, o e-mail do proprietário
 * continua valendo — é o que garante o acesso ao painel sem depender de
 * configuração manual na hospedagem.
 */
export function adminEmails() {
  const fromEnv = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const owner = 'veigakevin71@gmail.com'
  return fromEnv.length ? [...new Set([...fromEnv, owner])] : [owner]
}

/**
 * Garante que o usuário tenha uma linha em `profiles`.
 *
 * O banco NÃO tem trigger de criação de perfil (verificado: usuário novo no
 * Auth fica sem linha). Sem perfil, o painel admin não reconhece ninguém e o
 * nome do usuário não aparece. Criamos a linha com a Service Role — o usuário
 * não pode fazer isso sozinho sem esbarrar na RLS.
 *
 * `is_admin` só é concedido quando o e-mail está em ADMIN_EMAILS. Nunca vem do
 * cliente.
 */
export async function ensureProfile(user) {
  const admin = getAdminClient()
  if (!admin || !user?.id) return { profile: null, created: false, error: 'service_role_ausente' }

  const col = await detectNameColumn()
  const email = String(user.email ?? '').toLowerCase()
  const metaName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? null

  const { data: existing, error: readErr } = await admin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (readErr) return { profile: null, created: false, error: readErr.message }

  const shouldBeAdmin = adminEmails().includes(email)

  if (!existing) {
    const row = { id: user.id, email: user.email ?? null }
    if (col && metaName) row[col] = metaName
    if (shouldBeAdmin) row.is_admin = true

    const { data: created, error: insErr } = await admin
      .from('profiles')
      .insert(row)
      .select('*')
      .maybeSingle()

    if (insErr) return { profile: null, created: false, error: insErr.message }
    return { profile: normalizeProfile(created), created: true, error: null }
  }

  // Perfil existe: completa o nome se estiver vazio e promove o admin legítimo.
  const patch = {}
  if (col && !existing[col] && metaName) patch[col] = metaName
  if (shouldBeAdmin && !existing.is_admin) patch.is_admin = true

  if (Object.keys(patch).length === 0) {
    return { profile: normalizeProfile(existing), created: false, error: null }
  }

  const { data: updated, error: updErr } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('*')
    .maybeSingle()

  if (updErr) return { profile: normalizeProfile(existing), created: false, error: updErr.message }
  return { profile: normalizeProfile(updated), created: false, error: null }
}

/**
 * Cria a conta pelo SERVIDOR, com o e-mail já confirmado.
 *
 * Por que não usar o signUp do navegador: o projeto está com "Confirm email"
 * ligado e o SMTP padrão do Supabase não entrega para destinatários
 * arbitrários. Na prática o usuário se cadastrava e nunca conseguia entrar
 * (login devolvia `email_not_confirmed`) — verificado em 2026-11-18.
 *
 * Aqui a conta nasce confirmada (email_confirm: true) e o perfil é criado na
 * sequência. O cliente só precisa fazer login com a senha que escolheu.
 */
export async function createConfirmedUser({ email, password, fullName }) {
  const admin = getAdminClient()
  if (!admin) return { error: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY.', status: 503 }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  })

  if (error) {
    const msg = String(error.message ?? '')
    if (/already|registered|exists/i.test(msg)) {
      return { error: 'Este e-mail já está cadastrado.', status: 409 }
    }
    return { error: msg, status: 400 }
  }

  const { profile } = await ensureProfile(data.user)
  return { user: data.user, profile, error: null }
}

/**
 * Marca o e-mail como confirmado.
 *
 * O projeto está com "Confirm email" ligado e o SMTP padrão do Supabase não
 * entrega para destinatários arbitrários — na prática ninguém consegue entrar
 * depois de se cadastrar (verificado: login devolve `email_not_confirmed`).
 * Como o MovieFlix não exige verificação de e-mail para assistir, confirmamos
 * pelo servidor no momento do cadastro.
 */
export async function confirmEmail(userId) {
  const admin = getAdminClient()
  if (!admin || !userId) return { ok: false, error: 'service_role_ausente' }
  const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true })
  return { ok: !error, error: error?.message ?? null }
}

export { hasServiceRole }
