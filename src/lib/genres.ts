/**
 * Normalização de gêneros/categorias — fonte ÚNICA para o site.
 *
 * O catálogo vem do TMDB, que usa nomes COMPOSTOS em inglês para alguns
 * gêneros de série: "Action & Adventure", "Sci-Fi & Fantasy", "War & Politics".
 * O MovieFlix é em português e já tem "Ação", "Aventura", "Ficção científica"
 * etc. como categorias próprias — então "Action & Adventure" aparecia como uma
 * categoria DUPLICADA e em inglês no filtro, ao lado de Ação e Aventura.
 *
 * A regra aqui é só de APRESENTAÇÃO: o registro original do catálogo não é
 * alterado (nada é apagado, nenhum gênero original é perdido). O que muda é a
 * lista de termos que o app usa para filtrar e exibir.
 *
 * "Action & Adventure" → "Ação" + "Aventura" (um título com esse gênero passa a
 * aparecer nas duas categorias, que é o comportamento correto).
 */

/** Gêneros compostos do TMDB que têm equivalente em português no catálogo. */
const SPLIT: Record<string, string[]> = {
  'action & adventure': ['Ação', 'Aventura'],
}

/** Categorias que não devem ser exibidas como filtro (duplicadas/em inglês). */
const HIDDEN = new Set(['action & adventure'])

/**
 * Converte uma string de categoria ("Ação, Anima\u00e7\u00e3o, Fam\u00edlia") na lista
 * de termos normalizados, sem duplicatas e sem os compostos em inglês.
 */
export function splitCategory(raw: string | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (term: string) => {
    const clean = term.trim()
    if (!clean) return
    const key = clean.toLowerCase()
    if (HIDDEN.has(key)) return
    if (seen.has(key)) return
    seen.add(key)
    out.push(clean)
  }
  for (const part of String(raw ?? '').split(',')) {
    const clean = part.trim()
    if (!clean) continue
    const mapped = SPLIT[clean.toLowerCase()]
    if (mapped) {
      for (const m of mapped) push(m)
    } else {
      push(clean)
    }
  }
  return out
}

/** Categoria normalizada para exibição (string com vírgulas). */
export function normalizeCategory(raw: string | null | undefined): string {
  return splitCategory(raw).join(', ')
}

/** O título pertence ao gênero pedido? Compara por termo, não pela string toda. */
export function hasGenre(raw: string | null | undefined, genre: string): boolean {
  if (!genre || genre === 'Todos') return true
  const wanted = genre.trim().toLowerCase()
  return splitCategory(raw).some((g) => g.toLowerCase() === wanted)
}
