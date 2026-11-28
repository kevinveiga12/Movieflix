import { bearer, resolveUser } from './entitlement.js'
import { readProfiles, normalizeKind } from './profiles.js'

/**
 * Contexto de perfil para as rotas de catálogo e de reprodução.
 *
 * ── O PROBLEMA ──────────────────────────────────────────────────────────────
 * O perfil infantil só pode ver conteúdo infantil. A regra precisa valer no
 * site, no app Android e na TV — e os três falam com as MESMAS rotas
 * `/api/catalog/*` e `/api/playback/authorize`. Então o filtro tem de estar no
 * servidor, não na tela: esconder o card no navegador não impede ninguém de
 * abrir `/assistir/<id>` direto.
 *
 * ── POR QUE O TOKEN É OPCIONAL ──────────────────────────────────────────────
 * O catálogo é público (visitante sem conta vê a home). Só quando há um token
 * válido E o perfil ativo é infantil é que a lista é restringida. Sem token,
 * nada muda — o comportamento de hoje continua idêntico.
 *
 * ── CACHE ───────────────────────────────────────────────────────────────────
 * `resolveUser` faz uma chamada de rede ao Supabase. O app de TV pede o
 * catálogo em várias páginas seguidas; sem cache seriam dezenas de chamadas por
 * tela. Guardamos o resultado por token durante 60 s — curto o bastante para a
 * troca de perfil valer quase na hora, e longo o bastante para não pesar.
 */

const TTL_MS = 60_000
const cache = new Map()

function cacheGet(token) {
  const hit = cache.get(token)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(token)
    return null
  }
  return hit.value
}

function cacheSet(token, value) {
  // Poda simples: o mapa não pode crescer sem limite num processo de longa vida.
  if (cache.size > 500) {
    const now = Date.now()
    for (const [k, v] of cache) if (now - v.at > TTL_MS) cache.delete(k)
    if (cache.size > 500) cache.clear()
  }
  cache.set(token, { at: Date.now(), value })
}

/** Descarta o cache de um token (usado quando o perfil ativo muda). */
export function invalidateProfileContext(token) {
  if (token) cache.delete(token)
}

/**
 * Perfil ativo do portador do token.
 *
 * Devolve `{ authenticated, kidsOnly, profile }`. Nunca lança: token inválido
 * ou Supabase fora do ar caem em `{ authenticated: false, kidsOnly: false }`,
 * que é o comportamento público de sempre.
 */
export async function profileContext(req) {
  const token = bearer(req)
  if (!token) return { authenticated: false, kidsOnly: false, profile: null }

  const cached = cacheGet(token)
  if (cached) return cached

  let value = { authenticated: false, kidsOnly: false, profile: null }
  try {
    const resolved = await resolveUser(token)
    if (resolved.user) {
      const meta = resolved.user.app_metadata ?? {}
      const profiles = readProfiles(meta)
      const active = profiles.find((p) => p.id === meta.active_profile_id) ?? null
      value = {
        authenticated: true,
        kidsOnly: normalizeKind(active?.kind) === 'kids',
        profile: active,
      }
    }
  } catch {
    // Sem contexto de perfil: segue como visitante. Nunca derruba o catálogo.
  }

  cacheSet(token, value)
  return value
}

/** Atalho: o pedido vem de um perfil infantil? */
export async function isKidsRequest(req) {
  const ctx = await profileContext(req)
  return ctx.kidsOnly === true
}
