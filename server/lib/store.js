import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Armazenamento das edições administrativas.
 *
 * IMPORTANTE — por que um arquivo e não uma tabela nova:
 * o pedido exige preservar o Supabase antigo e NÃO criar tabelas sem aprovação
 * prévia. Então as edições do painel vivem em um JSON no servidor
 * (server/data/catalog-overrides.json), aplicado por cima do catálogo base.
 *
 * Vantagens: zero migração, zero risco ao banco, reversível (basta apagar o
 * arquivo). Se o proprietário aprovar uma tabela `catalog_overrides` no futuro,
 * só esta camada muda — o resto do código continua igual.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const OVERRIDES = path.join(DATA_DIR, 'catalog-overrides.json')

const EMPTY = { movies: {}, series: {}, hidden: [], updatedAt: null }

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

export async function readOverrides() {
  try {
    const raw = await fs.readFile(OVERRIDES, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...EMPTY, ...parsed }
  } catch {
    return { ...EMPTY }
  }
}

export async function writeOverrides(data) {
  await ensureDir()
  const payload = { ...data, updatedAt: new Date().toISOString() }
  await fs.writeFile(OVERRIDES, JSON.stringify(payload, null, 2), 'utf8')
  return payload
}

/** Aplica overrides sobre uma lista de títulos. */
export function applyOverrides(list, overrides, kind) {
  const map = kind === 'movie' ? overrides.movies : overrides.series
  const hidden = new Set(overrides.hidden ?? [])
  const out = []
  for (const t of list) {
    const key = String(t.tmdb_id ?? t.id)
    if (hidden.has(key)) continue
    const patch = map[key]
    out.push(patch ? { ...t, ...patch } : t)
  }
  return out
}
