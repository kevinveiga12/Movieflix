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
 * Localiza um usuário do Auth pelo e-mail, usando a API administrativa.
 *
 * Precisa da Service Role (a listagem de usuários não é pública). Pagina de 200
 * em 200 porque `listUsers` não aceita filtro por e-mail; paramos na primeira
 * página incompleta.
 */
export async function findAdminUserByEmail(email) {
  const admin = getAdminClient()
  if (!admin) return { user: null, error: 'service_role_ausente' }

  const target = String(email ?? '').trim().toLowerCase()
  if (!target) return { user: null, error: 'email_invalido' }

  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) return { user: null, error: error.message }
    const users = data?.users ?? []
    const hit = users.find((u) => String(u.email ?? '').toLowerCase() === target)
    if (hit) return { user: hit, error: null }
    if (users.length < 200) break
  }
  return { user: null, error: null }
}

/**
 * Confirma os e-mails de TODAS as contas que ainda estão pendentes.
 *
 * Por que existe: o projeto nasceu com "Confirm email" ligado. Toda conta criada
 * antes desta correção ficou presa em `email_not_confirmed` e não conseguia
 * entrar — o login devolvia "Invalid login credentials"/`email not confirmed`.
 * A política do MovieFlix 2.0 é não exigir confirmação de e-mail, então as
 * contas antigas têm de ser liberadas também.
 *
 * Preserva integralmente: o ID do usuário, a senha (não é tocada), o perfil,
 * favoritos, histórico e qualquer relacionamento por `user_id`. Só grava
 * `email_confirmed_at`.
 */
export async function confirmAllPendingEmails() {
  const admin = getAdminClient()
  if (!admin) return { scanned: 0, confirmed: 0, failed: 0, error: 'service_role_ausente' }

  let scanned = 0
  let confirmed = 0
  let failed = 0

  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) return { scanned, confirmed, failed, error: error.message }

    const users = data?.users ?? []
    if (users.length === 0) break
    scanned += users.length

    for (const u of users) {
      // `confirmed_at` é coluna gerada; a que se grava é `email_confirmed_at`.
      if (!u.email || u.email_confirmed_at) continue
      const { error: e } = await admin.auth.admin.updateUserById(u.id, { email_confirm: true })
      if (e) failed++
      else confirmed++
    }

    if (users.length < 200) break
  }

  return { scanned, confirmed, failed, error: null }
}

/** Quantas contas seguem pendentes de confirmação (só leitura). */
export async function countPendingEmails() {
  const admin = getAdminClient()
  if (!admin) return { pending: null, total: null, error: 'service_role_ausente' }

  let pending = 0
  let total = 0

  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) return { pending: null, total: null, error: error.message }
    const users = data?.users ?? []
    if (users.length === 0) break
    total += users.length
    pending += users.filter((u) => u.email && !u.email_confirmed_at).length
    if (users.length < 200) break
  }

  return { pending, total, error: null }
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
