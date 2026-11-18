import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadRuntimeConfig } from './runtimeConfig'

/**
 * Cliente Supabase do navegador.
 *
 * A configuração vem, em ordem de prioridade:
 *   1. GET /api/config  (runtime — vale sem rebuild, é o caminho normal)
 *   2. import.meta.env.VITE_*  (build — fallback para `npm run dev` local)
 *
 * O cliente é criado de forma assíncrona porque a config de runtime precisa de
 * um fetch. `initSupabase()` é chamado uma única vez no boot (main.tsx) antes
 * de renderizar o app; depois disso `supabase` está pronto e é síncrono.
 */

const buildUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const buildAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let client: SupabaseClient | null = null
let configured = false

function makeClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'movieflix-auth',
    },
  })
}

/**
 * Resolve a configuração e cria o cliente. Idempotente.
 * Devolve `true` se o Supabase ficou configurado.
 */
export async function initSupabase(): Promise<boolean> {
  if (client) return configured

  const runtime = await loadRuntimeConfig()
  const url = runtime?.supabaseUrl ?? buildUrl
  const anonKey = runtime?.supabaseAnonKey ?? buildAnon

  if (!url || !anonKey) {
    console.error(
      '[MovieFlix] Supabase não configurado. O servidor precisa de SUPABASE_URL e ' +
        'SUPABASE_ANON_KEY (ou VITE_SUPABASE_* no build).',
    )
    // Cliente inerte para o app não quebrar na renderização; as chamadas falham
    // com mensagem clara em vez de derrubar a árvore React.
    client = makeClient('http://localhost', 'anon')
    configured = false
    return false
  }

  client = makeClient(url, anonKey)
  configured = true
  return true
}

/**
 * Cliente pronto. Só é válido depois de `initSupabase()`.
 * O Proxy garante erro explícito se alguém usar antes do boot.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!client) {
      throw new Error(
        '[MovieFlix] supabase usado antes de initSupabase(). Chame initSupabase() no boot.',
      )
    }
    const value = (client as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export function isSupabaseConfigured(): boolean {
  return configured
}
