import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import type { Profile } from '../lib/types'

interface AuthState {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error: string | null; needsConfirmation: boolean }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: string | null }>
  updatePassword: (password: string) => Promise<{ error: string | null }>
  updateProfile: (patch: Partial<Pick<Profile, 'name' | 'avatar_url'>>) => Promise<{ error: string | null }>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

function friendly(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.'
  if (m.includes('user already registered')) return 'Este e-mail já está cadastrado.'
  if (m.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Aguarde um instante.'
  if (m.includes('unable to validate email')) return 'E-mail inválido.'
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name, avatar_url, is_admin, created_at')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      console.warn('[MovieFlix] perfil não carregado:', error.message)
      setProfile(null)
      return
    }

    // O banco NÃO tem trigger que crie `profiles` no signup (verificado em
    // 2026-11-18: usuário novo fica sem linha). Sem perfil, o painel admin não
    // reconhece ninguém. Criamos a linha do PRÓPRIO usuário — a RLS permite
    // INSERT do próprio id, e `is_admin` nunca é enviado aqui.
    if (!data) {
      const { data: created, error: insErr } = await supabase
        .from('profiles')
        .insert({ id: userId })
        .select('id, email, name, avatar_url, is_admin, created_at')
        .maybeSingle()
      if (insErr) {
        console.warn('[MovieFlix] perfil não criado:', insErr.message)
        setProfile(null)
        return
      }
      setProfile((created as Profile) ?? null)
      return
    }

    setProfile(data as Profile)
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) void loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (next?.user) void loadProfile(next.user.id)
      else setProfile(null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      loading,
      isAdmin: Boolean(profile?.is_admin),
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return { error: error ? friendly(error.message) : null }
      },
      async signUp(email, password, fullName) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        })
        if (error) return { error: friendly(error.message), needsConfirmation: false }
        // Sem sessão = confirmação de e-mail pendente.
        return { error: null, needsConfirmation: !data.session }
      },
      async signOut() {
        await supabase.auth.signOut()
        setProfile(null)
      },
      async resetPassword(email) {
        const redirectTo = `${window.location.origin}/redefinir-senha`
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        return { error: error ? friendly(error.message) : null }
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password })
        return { error: error ? friendly(error.message) : null }
      },
      async updateProfile(patch) {
        if (!session?.user) return { error: 'Sessão expirada.' }
        const { error } = await supabase.from('profiles').update(patch).eq('id', session.user.id)
        if (error) return { error: friendly(error.message) }
        await loadProfile(session.user.id)
        return { error: null }
      },
      async refreshProfile() {
        if (session?.user) await loadProfile(session.user.id)
      },
    }),
    [session, profile, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
