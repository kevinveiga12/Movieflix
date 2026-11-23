/**
 * Embaralhamento determinístico por semente.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O catálogo era sempre servido na mesma ordem (popularidade decrescente), então
 * todo acesso mostrava exatamente os mesmos títulos nas primeiras posições.
 *
 * A variedade precisa de duas propriedades ao mesmo tempo:
 *
 *   1. ESTÁVEL durante a navegação — se a ordem mudasse a cada requisição, a
 *      paginação quebraria: a página 2 poderia repetir um título da página 1 e
 *      deixar outro de fora.
 *   2. DIFERENTE a cada acesso — duas visitas devem ver combinações distintas.
 *
 * A solução é uma permutação determinística: a mesma semente produz sempre a
 * mesma ordem; sementes diferentes produzem ordens diferentes. O cliente gera
 * uma semente por sessão e a reenvia em cada página, então a paginação continua
 * coerente e cada novo acesso recebe outra combinação.
 *
 * ── Por que não `Math.random()` ─────────────────────────────────────────────
 *
 * `Math.random()` não aceita semente: não há como reproduzir a ordem na página
 * seguinte. Aqui usamos mulberry32 (PRNG de 32 bits, rápido e de boa
 * distribuição) alimentado por um hash FNV-1a da semente textual.
 *
 * Nada é removido, escondido ou filtrado: a permutação usa a lista inteira, de
 * modo que todos os títulos continuam alcançáveis pela paginação.
 */

/** Hash FNV-1a de 32 bits — estável entre processos e versões do Node. */
export function hashSeed(value) {
  const str = String(value ?? '')
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** PRNG determinístico (mulberry32). Devolve uma função que gera [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fisher–Yates com PRNG semeado.
 *
 * Devolve uma CÓPIA — o array recebido nunca é mutado (o catálogo em cache é
 * compartilhado por todo o processo e não pode ser reordenado no lugar).
 */
export function shuffleWithSeed(list, seed) {
  const out = Array.isArray(list) ? [...list] : []
  if (out.length < 2) return out
  const rand = mulberry32(hashSeed(seed))
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/**
 * Amostra `count` itens de `list` de forma determinística.
 *
 * Usado pelas fileiras da home: em vez de "os 20 mais populares" (iguais em
 * todo acesso), pega uma amostra variada de um pool grande e mantém a ordem
 * interna do pool. Assim a fileira continua fazendo sentido (são populares,
 * são recentes, são do gênero) mas os títulos exibidos mudam.
 */
export function sampleWithSeed(list, count, seed) {
  const pool = Array.isArray(list) ? list : []
  if (count >= pool.length) return [...pool]
  const rand = mulberry32(hashSeed(seed))
  // Amostragem por índice parcial de Fisher–Yates: O(count), sem copiar tudo.
  const idx = pool.map((_, i) => i)
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rand() * (idx.length - i))
    const tmp = idx[i]
    idx[i] = idx[j]
    idx[j] = tmp
  }
  return idx.slice(0, count).map((i) => pool[i])
}
