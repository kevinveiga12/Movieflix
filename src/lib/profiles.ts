import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Perfis da conta — espelho do cliente de `server/lib/profiles.js`.
 *
 * ── POR QUE O CLIENTE TAMBÉM CONHECE A REGRA ────────────────────────────────
 * O servidor é quem DECIDE (recusa a criação acima do limite e filtra o
 * catálogo). Aqui a regra existe só para a tela: mostrar "2 de 2 perfis" e
 * desabilitar o botão antes de o cliente clicar. Se as duas versões
 * divergirem, o servidor vence — a tela nunca é a barreira.
 *
 * Os limites são os mesmos do servidor. Se mudarem lá, mude aqui.
 */

export type ProfileKind = 'adult' | 'kids'

export interface AccountProfile {
  id: string
  name: string
  kind: ProfileKind
  created_at: string | null
}

export interface ProfileLimits {
  adult: number
  kids: number
}

export interface ProfileSummary {
  plan: string | null
  planLabel: string | null
  limits: ProfileLimits
  used: { adult: number; kids: number; total: number }
  canCreateAdult: { allowed: boolean; reason: string | null; limit: number; used: number }
  canCreateKids: { allowed: boolean; reason: string | null; limit: number; used: number }
}

export const PLAN_PROFILE_LIMITS: Record<string, ProfileLimits> = {
  basico: { adult: 1, kids: 0 },
  standard: { adult: 2, kids: 1 },
  premium: { adult: 4, kids: 1 },
}

export const PLAN_LABELS: Record<string, string> = {
  basico: 'Básico',
  standard: 'Médio',
  premium: 'Premium',
}

const NO_PLAN_LIMITS: ProfileLimits = { adult: 1, kids: 0 }

export function limitsForPlan(planCode: string | null | undefined): ProfileLimits {
  const code = String(planCode ?? '').trim().toLowerCase()
  return PLAN_PROFILE_LIMITS[code] ? { ...PLAN_PROFILE_LIMITS[code] } : { ...NO_PLAN_LIMITS }
}

/* ────────────────────────────────────────────────────────────────────────────
 * CONTEÚDO INFANTIL (espelho de server/lib/profiles.js)
 * ──────────────────────────────────────────────────────────────────────────── */

const KIDS_GENRES = new Set(['animacao', 'familia', 'kids', 'infantil'])
const ADULT_GENRES = new Set([
  'terror',
  'suspense',
  'crime',
  'guerra',
  'erotico',
  'adulto',
  'drogas',
  'assassinato',
  'faroeste',
  'soap',
])

function fold(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** O título é conteúdo infantil? Mesma regra do servidor. */
export function isKidsContent(titleOrCategory: { category?: string | null } | string | null | undefined): boolean {
  const category = typeof titleOrCategory === 'string' ? titleOrCategory : titleOrCategory?.category
  const terms = String(category ?? '')
    .split(',')
    .map((p) => fold(p).trim())
    .filter(Boolean)
  if (terms.length === 0) return false
  if (terms.some((t) => ADULT_GENRES.has(t))) return false
  return terms.some((t) => KIDS_GENRES.has(t))
}

/* ────────────────────────────────────────────────────────────────────────────
 * API
 * ──────────────────────────────────────────────────────────────────────────── */

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()), ...(init?.headers ?? {}) }
  const res = await fetch(`/api/profiles${path}`, { ...init, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Erro ${res.status}`)
  return body as T
}

export interface ProfilesResponse extends ProfileSummary {
  profiles: AccountProfile[]
  activeProfileId: string | null
}

export function fetchProfiles(): Promise<ProfilesResponse> {
  return call<ProfilesResponse>('')
}

export function createProfile(name: string, kind: ProfileKind): Promise<ProfilesResponse & { profile: AccountProfile }> {
  return call('', { method: 'POST', body: JSON.stringify({ name, kind }) })
}

export function setActiveProfile(profileId: string): Promise<{ ok: boolean; activeProfileId: string }> {
  return call('/active', { method: 'PUT', body: JSON.stringify({ profileId }) })
}

export function deleteProfile(id: string): Promise<ProfilesResponse> {
  return call(`/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* ────────────────────────────────────────────────────────────────────────────
 * HOOK
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Perfis da conta logada.
 *
 * `kidsOnly` é o que o catálogo, a busca e o player consultam para restringir
 * o conteúdo. Ele vem do perfil ATIVO — trocar de perfil na tela de perfis
 * muda o valor e o site passa a mostrar só conteúdo infantil na hora.
 */
export function useProfiles(enabled = true) {
  const [data, setData] = useState<ProfilesResponse | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!enabled) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setData(await fetchProfiles())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar os perfis.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  const active = data?.profiles.find((p) => p.id === data.activeProfileId) ?? null

  return {
    profiles: data?.profiles ?? [],
    activeProfile: active,
    activeProfileId: data?.activeProfileId ?? null,
    kidsOnly: active?.kind === 'kids',
    summary: data,
    loading,
    error,
    reload,
  }
}
