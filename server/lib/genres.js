/**
 * Normalização de gêneros — espelho de `src/lib/genres.ts` para o servidor.
 *
 * O site e a API precisam concordar sobre a lista de categorias, senão o filtro
 * do frontend pede "Ação" e a API devolve vazio (ou o contrário). Este módulo é
 * a cópia canônica do lado do servidor; se a regra mudar, mude nos dois.
 *
 * Nada aqui altera o catálogo: o registro original continua com o gênero do
 * TMDB. Só a APRESENTAÇÃO e o FILTRO usam os termos normalizados.
 */

const SPLIT = {
  'action & adventure': ['Ação', 'Aventura'],
}

const HIDDEN = new Set(['action & adventure'])

/** "Ação, Animação" → ['Ação','Animação'], desdobrando compostos em inglês. */
export function splitCategory(raw) {
  const out = []
  const seen = new Set()
  const push = (term) => {
    const clean = String(term ?? '').trim()
    if (!clean) return
    const key = clean.toLowerCase()
    if (HIDDEN.has(key) || seen.has(key)) return
    seen.add(key)
    out.push(clean)
  }
  for (const part of String(raw ?? '').split(',')) {
    const clean = part.trim()
    if (!clean) continue
    const mapped = SPLIT[clean.toLowerCase()]
    if (mapped) for (const m of mapped) push(m)
    else push(clean)
  }
  return out
}

/** O título pertence ao gênero pedido? Compara por termo. */
export function hasGenre(raw, genre) {
  if (!genre || genre === 'Todos') return true
  const wanted = String(genre).trim().toLowerCase()
  return splitCategory(raw).some((g) => g.toLowerCase() === wanted)
}
