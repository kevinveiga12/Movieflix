/**
 * Busca de clientes no painel administrativo.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ──────────────────────────────────────────────
 * O filtro da lista de usuários precisa achar por E-MAIL e por NOME, ignorando
 * maiúsculas e acentos ("jose" tem de achar "José"). Duas coisas impedem fazer
 * isso direto no Postgres:
 *
 *   • `ilike` não ignora acento;
 *   • a coluna de nome varia entre os projetos Supabase do histórico
 *     (`name` no antigo, `full_name` no atual) — nomear a coluna errada devolve
 *     42703 e derruba a consulta inteira.
 *
 * Então a rota lê as linhas de `profiles` e filtra AQUI, em JS, sobre o objeto
 * já normalizado por `normalizeProfile()`. Este módulo é puro (sem Supabase, sem
 * Express) justamente para poder ser testado sem banco — ver
 * `scripts/test-admin-users.mjs`.
 */

/** Normaliza para comparação: minúsculas e sem acento. */
export function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Um perfil bate com a busca?
 *
 * A busca é por SUBSTRING, não por prefixo: o administrador costuma lembrar de
 * um pedaço do e-mail ("gmail", "julho") ou do sobrenome, não do começo.
 * Vários termos separados por espaço precisam TODOS bater (em qualquer campo),
 * o que permite "maria gmail" achar maria...@gmail.com.
 */
export function matchesQuery(profile, query) {
  const terms = fold(query).trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = `${fold(profile?.email)} ${fold(profile?.name)}`
  return terms.every((t) => haystack.includes(t))
}

/** Filtra uma lista de perfis normalizados. Sem `query`, devolve a lista como está. */
export function filterProfiles(profiles, query) {
  const q = String(query ?? '').trim()
  if (!q) return profiles ?? []
  return (profiles ?? []).filter((p) => matchesQuery(p, q))
}
