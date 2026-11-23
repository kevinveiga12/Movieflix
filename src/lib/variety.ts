/**
 * Variedade do catálogo por sessão — lado do cliente.
 *
 * ── O que este módulo garante ───────────────────────────────────────────────
 *
 * 1. ESTABILIDADE: a semente é criada uma vez por sessão e guardada em
 *    `sessionStorage`. Enquanto a pessoa navega (home → filmes → série → volta),
 *    a ordem é sempre a mesma. Sem isso a tela "pularia" a cada navegação e a
 *    paginação repetiria títulos.
 *
 * 2. VARIEDADE: cada novo acesso (nova aba, novo sessionStorage) recebe outra
 *    semente, portanto outra combinação de filmes e séries nas fileiras.
 *
 * 3. NADA É REMOVIDO: a permutação usa a lista inteira. Todo título continua
 *    alcançável pela busca, pelo catálogo e pelas categorias.
 *
 * O algoritmo é o MESMO do servidor (`server/lib/shuffle.js`): mulberry32
 * alimentado por um hash FNV-1a. Assim a ordem que o site calcula localmente é
 * idêntica à que a API devolve para a mesma semente — o app de TV e o site
 * mostram a mesma combinação quando compartilham a semente.
 */

const SEED_KEY = 'movieflix-variety-seed'

/** Hash FNV-1a de 32 bits. */
function hashSeed(value: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** PRNG determinístico (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Semente da sessão atual.
 *
 * `sessionStorage` é por aba e sobrevive a recarregamentos — exatamente o
 * escopo desejado: estável enquanto a pessoa navega, nova em cada acesso.
 * Se o navegador bloquear o storage (modo privado restrito), cai para uma
 * semente em memória, que ainda é estável durante a vida da página.
 */
let memorySeed: string | null = null

export function sessionSeed(): string {
  if (memorySeed) return memorySeed
  try {
    const existing = window.sessionStorage.getItem(SEED_KEY)
    if (existing) {
      memorySeed = existing
      return existing
    }
    const fresh = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    window.sessionStorage.setItem(SEED_KEY, fresh)
    memorySeed = fresh
    return fresh
  } catch {
    memorySeed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    return memorySeed
  }
}

/** Fisher–Yates semeado. Devolve uma cópia; nunca muta a lista recebida. */
export function shuffleWithSeed<T>(list: T[], seed: string): T[] {
  const out = [...list]
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
 * Usada pelas fileiras da home: mantém o critério da fileira (populares,
 * recentes, do gênero) mas troca QUAIS títulos aparecem a cada acesso.
 */
export function sampleWithSeed<T>(list: T[], count: number, seed: string): T[] {
  if (count >= list.length) return [...list]
  const rand = mulberry32(hashSeed(seed))
  const idx = list.map((_, i) => i)
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rand() * (idx.length - i))
    const tmp = idx[i]
    idx[i] = idx[j]
    idx[j] = tmp
  }
  return idx.slice(0, count).map((i) => list[i])
}

/**
 * Tamanho do pool que recebe a variação.
 *
 * Embaralhar o topo (e não a lista inteira) mantém a fileira coerente — os
 * títulos continuam sendo os populares/recentes — e evita que um item obscuro
 * apareça na primeira posição. 500 é o piso pedido pelo proprietário.
 */
export const VARIETY_POOL = 500

/** Aplica a variação sobre uma lista JÁ ordenada, preservando o resto da ordem. */
export function applyVariety<T>(sorted: T[], seed: string): T[] {
  if (sorted.length < 2) return [...sorted]
  const poolSize = Math.min(VARIETY_POOL, sorted.length)
  return shuffleWithSeed(sorted.slice(0, poolSize), seed).concat(sorted.slice(poolSize))
}
