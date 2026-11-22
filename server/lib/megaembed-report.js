/**
 * Leitura do relatório de disponibilidade do MegaEmbed.
 *
 * O arquivo é gerado por `scripts/validar-megaembed.mjs` e fica em
 * `public/filmes/megaembed-disponibilidade.json`. Se não existir, devolvemos
 * zeros — nunca inventamos números.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(__dirname, '..', '..', 'public', 'filmes', 'megaembed-disponibilidade.json')

let cache = null

export async function readMegaEmbedReport() {
  if (cache) return cache
  try {
    const raw = await fs.readFile(FILE, 'utf8')
    const data = JSON.parse(raw)
    cache = {
      updatedAt: data.gerado_em ?? null,
      movies: data.filmes_disponiveis ?? 0,
      series: data.series_disponiveis ?? 0,
      episodes: data.episodios_disponiveis ?? 0,
      unavailable: data.indisponiveis ?? 0,
      failures: Array.isArray(data.falhas) ? data.falhas : [],
    }
  } catch {
    cache = {
      updatedAt: null,
      movies: 0,
      series: 0,
      episodes: 0,
      unavailable: 0,
      failures: [],
    }
  }
  return cache
}
