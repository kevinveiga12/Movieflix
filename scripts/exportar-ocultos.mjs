#!/usr/bin/env node
/**
 * EXPORTA OS TÍTULOS OCULTOS PARA O BASELINE COMITADO.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE SCRIPT EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A lista de ocultos vive em `server/data/catalog-overrides.json`, que está no
 * `.gitignore` — é estado de runtime, não código. O filesystem do app é recriado
 * a cada deploy (o plano Free não tem volume persistente), então o que for
 * ocultado pelo painel some quando sai uma versão nova.
 *
 * Este script resolve isso SEM tocar no banco: ele copia o que está no arquivo
 * de runtime para `server/data/hidden-baseline.json`, que é COMITADO. O app lê o
 * baseline como semente quando o arquivo de runtime não existe.
 *
 * Ou seja: ocultou no painel → roda este script → commita → a ocultação passa a
 * valer em todos os deploys futuros.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * USO
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   node scripts/exportar-ocultos.mjs
 *   git add server/data/hidden-baseline.json && git commit -m "chore: ocultos"
 *
 * Se preferir puxar direto do servidor de produção (o arquivo local pode estar
 * desatualizado), use a rota do painel: GET /api/admin/hidden.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DATA = path.join(ROOT, 'server', 'data')
const RUNTIME = path.join(DATA, 'catalog-overrides.json')
const BASELINE = path.join(DATA, 'hidden-baseline.json')

async function main() {
  let runtime
  try {
    runtime = JSON.parse(await fs.readFile(RUNTIME, 'utf8'))
  } catch {
    console.error(`${path.relative(ROOT, RUNTIME)} não existe ou está vazio.`)
    console.error('Nada a exportar: o baseline atual já é o que está valendo.')
    process.exit(0)
  }

  const hidden = Array.isArray(runtime.hidden) ? runtime.hidden : []
  if (hidden.length === 0) {
    console.log('A lista de ocultos está vazia — o baseline não foi alterado.')
    process.exit(0)
  }

  // Preserva as entradas que já estavam no baseline e não estão no runtime:
  // assim um título ocultado por verificação não é "esquecido" só porque o
  // runtime foi recriado.
  let previous = []
  try {
    previous = JSON.parse(await fs.readFile(BASELINE, 'utf8')).hidden ?? []
  } catch {
    previous = []
  }

  const key = (e) => `${e.type ?? '*'}:${e.tmdb_id}`
  const merged = new Map()
  for (const e of previous) merged.set(key(e), e)
  for (const e of hidden) merged.set(key(e), e)

  const list = [...merged.values()]
  const em = new Date().toISOString()

  await fs.mkdir(DATA, { recursive: true })
  await fs.writeFile(
    BASELINE,
    JSON.stringify(
      {
        _comentario:
          'Títulos ocultos. COMITADO de propósito: sobrevive ao deploy (o plano Free não tem volume persistente). Gerado por scripts/exportar-ocultos.mjs a partir de server/data/catalog-overrides.json.',
        gerado_em: em,
        total_oculto: list.length,
        hidden: list,
      },
      null,
      2,
    ),
    'utf8',
  )

  console.log(`Baseline atualizado: ${list.length} título(s) em server/data/hidden-baseline.json`)
  console.log('Agora commite esse arquivo para valer nos próximos deploys.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
