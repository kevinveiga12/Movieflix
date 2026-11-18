/**
 * Configuração de runtime do frontend.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * `VITE_*` é resolvido em TEMPO DE BUILD: o Vite substitui o literal no bundle.
 * Se a hospedagem não tiver essas variáveis no momento do `npm run build`, o
 * bundle sai com `undefined` e o app quebra em produção — foi exatamente o que
 * aconteceu no primeiro deploy na Velixir ("Failed to fetch" no cadastro).
 *
 * SOLUÇÃO
 * O servidor Express expõe GET /api/config com os valores que ele já tem em
 * runtime. O frontend lê esse endpoint antes de criar o cliente Supabase.
 * Assim o build não depende de nenhuma variável, e trocar a chave no painel da
 * hospedagem passa a valer sem rebuild.
 *
 * SEGURANÇA: só a URL e a chave ANON (pública por design, protegida por RLS)
 * são expostas. A SERVICE ROLE KEY nunca entra aqui.
 */

export interface RuntimeConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  configured: boolean
  whatsapp?: { number: string; display: string }
}

let cached: RuntimeConfig | null = null
let inflight: Promise<RuntimeConfig | null> | null = null

/** Lê a configuração do servidor. Nunca lança — devolve null se indisponível. */
export async function loadRuntimeConfig(): Promise<RuntimeConfig | null> {
  if (cached) return cached
  if (inflight) return inflight

  inflight = (async (): Promise<RuntimeConfig | null> => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' })
      if (!res.ok) return null
      const data = (await res.json()) as RuntimeConfig
      if (!data?.supabaseUrl || !data?.supabaseAnonKey) return null
      cached = data
      return data
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** Configuração já resolvida (síncrona) — usada depois do boot. */
export function getRuntimeConfig(): RuntimeConfig | null {
  return cached
}
