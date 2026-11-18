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
  requestCode: (email: string) => Promise<{ error: string | null; sent: boolean }>
  verifyCode: (email: string, code: string, password: string) => Promise<{ error: string | null }>
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

  /**
   * Carrega o perfil.
   *
   * O perfil é criado pelo SERVIDOR (POST /api/profile/ensure), não pelo
   * navegador: o banco não tem trigger de criação e a RLS impede o cliente de
   * inserir a própria linha de forma confiável. O servidor usa a Service Role e
   * é o único que pode conceder `is_admin` (via ADMIN_EMAILS).
   *
   * A leitura usa `select('*')` porque a coluna de nome varia entre os
   * projetos Supabase (`name` vs `full_name`) — nomear a errada devolve 42703.
   */
  async function loadProfile(userId: string, token?: string) {
    const accessToken = token ?? session?.access_token

    if (accessToken) {
      try {
        const res = await fetch('/api/profile/ensure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        })
        if (res.ok) {
          const data = (await res.json()) as { profile: Profile | null }
          if (data.profile) {
            setProfile(data.profile)
            return
          }
        }
      } catch {
        // Servidor indisponível — cai na leitura direta abaixo.
      }
    }

    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) {
      console.warn('[MovieFlix] perfil não carregado:', error.message)
      setProfile(null)
      return
    }
    if (!data) {
      setProfile(null)
      return
    }
    const row = data as Record<string, unknown>
    setProfile({
      id: String(row.id),
      email: (row.email as string) ?? null,
      name: (row.name ?? row.full_name ?? row.display_name ?? null) as string | null,
      avatar_url: (row.avatar_url as string) ?? null,
      is_admin: Boolean(row.is_admin),
      created_at: (row.created_at as string) ?? '',
    })
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
      if (data.session?.user) void loadProfile(data.session.user.id, data.session.access_token)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (next?.user) void loadProfile(next.user.id, next.access_token)
      else setProfile(null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      loading,
      isAdmin: Boolean(profile?.is_admin),
      async signIn(email, password) {
        // Login pelo SERVIDOR (POST /api/auth/login).
        //
        // O signInWithPassword direto no navegador falha para qualquer conta
        // cujo e-mail ainda não foi confirmado — e o SMTP padrão do projeto não
        // entrega a mensagem de confirmação, então a conta nunca é liberada. O
        // servidor faz a confirmação pela API administrativa na mesma
        // requisição, preservando a senha e o id do usuário.
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          })
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
            session?: { access_token: string; refresh_token: string }
          }
          if (!res.ok || !data.session) {
            return { error: friendly(data.error ?? `Falha ao entrar (HTTP ${res.status}).`) }
          }

          const { error } = await supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          })
          if (error) return { error: friendly(error.message) }
          return { error: null }
        } catch (e) {
          return { error: friendly((e as Error).message) }
        }
      },
      async signUp(email, password, fullName) {
        // Cadastro pelo SERVIDOR: a conta nasce com o e-mail já confirmado.
        // O signUp do navegador deixa o usuário preso em `email_not_confirmed`
        // porque o SMTP padrão do Supabase não entrega para qualquer endereço.
        try {
          const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, fullName }),
          })
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
            trial?: { granted: boolean; endsAt: string | null } | null
          }
          if (!res.ok) {
            return { error: friendly(data.error ?? `Falha no cadastro (HTTP ${res.status}).`), needsConfirmation: false }
          }
          // Guarda o resultado do benefício para a tela de cadastro informar
          // com honestidade se os 30 dias foram concedidos ou não.
          try {
            sessionStorage.setItem('mf_signup_trial', JSON.stringify(data.trial ?? null))
          } catch {
            /* modo privado pode bloquear — não é crítico */
          }
        } catch (e) {
          return { error: friendly((e as Error).message), needsConfirmation: false }
        }

        // Conta criada e confirmada — entra direto.
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          return { error: friendly(error.message), needsConfirmation: false }
        }
        return { error: null, needsConfirmation: false }
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
      /**
       * Pede o código de 6 dígitos.
       *
       * O código é gerado e validado pelo Supabase; o servidor só o envia por
       * e-mail. Não existe código fixo nem simulação: se o SMTP do servidor não
       * estiver configurado, a resposta traz o motivo real e o usuário recebe
       * uma mensagem de erro em vez de um falso "enviado".
       */
      async requestCode(email) {
        try {
          const res = await fetch('/api/auth/request-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          })
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
            sent?: boolean
          }
          if (!res.ok) return { error: friendly(data.error ?? `Falha ao enviar (HTTP ${res.status}).`), sent: false }
          return { error: null, sent: Boolean(data.sent) }
        } catch (e) {
          return { error: friendly((e as Error).message), sent: false }
        }
      },
      async verifyCode(email, code, password) {
        try {
          const res = await fetch('/api/auth/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, password }),
          })
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          if (!res.ok) return { error: friendly(data.error ?? `Falha ao validar (HTTP ${res.status}).`) }
          return { error: null }
        } catch (e) {
          return { error: friendly((e as Error).message) }
        }
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password })
        return { error: error ? friendly(error.message) : null }
      },
      async updateProfile(patch) {
        if (!session?.user) return { error: 'Sessão expirada.' }
        // A coluna de nome pode ser `name` ou `full_name`; tentamos as duas.
        const attempts: Array<Record<string, unknown>> = []
        if (patch.name !== undefined) {
          attempts.push({ name: patch.name })
          attempts.push({ full_name: patch.name })
        }
        if (patch.avatar_url !== undefined) attempts.push({ avatar_url: patch.avatar_url })

        let lastError: string | null = null
        for (const body of attempts) {
          const { error } = await supabase.from('profiles').update(body).eq('id', session.user.id)
          if (!error) {
            await loadProfile(session.user.id)
            return { error: null }
          }
          lastError = error.message
        }
        return { error: lastError ? friendly(lastError) : null }
      },
      async refreshProfile() {
        if (session?.user) await loadProfile(session.user.id)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, profile, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
