#!/usr/bin/env node
/**
 * GERA O CATÁLOGO FILTRADO A PARTIR DA VERIFICAÇÃO REAL.
 *
 * Entrada: o JSONL produzido por `scripts/verificar-catalogo-real.mjs`
 *          (uma linha por título, com `estado`: funciona | sem_fonte | incerto).
 *
 * Saída:
 *   1. `public/filmes/megaembed-disponibilidade.json`
 *      → a lista de IDs que REALMENTE reproduzem. É o arquivo que o servidor
 *        (`server/lib/static-catalog.js`) e o site (`src/lib/catalog.ts`) usam
 *        para filtrar home, catálogo, busca, gêneros, relacionados e paginação.
 *        Os apps Android/iOS/TV leem `/api/catalog/availability`, que sai daqui.
 *
 *   2. `server/data/hidden-baseline.json`
 *      → os títulos removidos, com motivo e evidência. Comitado de propósito:
 *        sobrevive ao deploy e é o que esconde cards antigos de Favoritos e
 *        "Continuar assistindo" (que vivem no Supabase e não podem ser apagados).
 *
 *   3. `documents/limpeza-catalogo/removidos.json` + `.csv`
 *      → o relatório completo, para auditoria.
 *
 * REGRA DE SEGURANÇA: `incerto` NUNCA é removido. Só sai do catálogo o título
 * com sinal POSITIVO de que o provedor não tem fonte.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const args = process.argv.slice(2)
const value = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}

const INPUT = value('--in', '/tmp/verificacao-catalogo.jsonl')
const DRY = args.includes('--dry')

async function readJsonl(file) {
  const raw = await fs.readFile(file, 'utf8')
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* linha truncada no fim do arquivo: ignora */
    }
  }
  return out
}

async function main() {
  const rows = await readJsonl(INPUT)
  if (!rows.length) throw new Error(`nenhum registro em ${INPUT}`)

  // Deduplica por tipo:id (a retomada pode ter reescrito uma linha).
  const byKey = new Map()
  for (const r of rows) byKey.set(`${r.type}:${r.tmdb_id}`, r)
  const all = [...byKey.values()]

  const funciona = all.filter((r) => r.estado === 'funciona')
  const semFonte = all.filter((r) => r.estado === 'sem_fonte')
  const incerto = all.filter((r) => r.estado === 'incerto')

  const filmes = funciona.filter((r) => r.type === 'movie').map((r) => Number(r.tmdb_id))
  const series = funciona.filter((r) => r.type === 'tv').map((r) => Number(r.tmdb_id))

  const removidos = semFonte.map((r) => ({
    tmdb_id: String(r.tmdb_id),
    type: r.type,
    title: r.title ?? '',
    year: r.year ?? '',
    poster_url: r.poster_url ?? '',
    motivo: r.motivo ?? 'provedor sem fonte',
    opcoes: r.opcoes ?? [],
  }))

  const agora = new Date().toISOString()

  const disponibilidade = {
    gerado_em: agora,
    provedor: 'playerflix.ink (verificação real por título)',
    base: 'https://playerflix.ink/inc/Ajax.php',
    fonte_dos_ids: 'scripts/verificar-catalogo-real.mjs — testou cada título do catálogo',
    criterio:
      'FUNCIONA = o provedor devolveu ao menos uma opção com budget "success" (fonte real). ' +
      'NÃO FUNCIONA = status:false ou somente opções budget "danger". INCERTO = erro de rede, mantido.',
    catalogo_provedor: {
      testados: all.length,
      funciona: funciona.length,
      sem_fonte: semFonte.length,
      incerto: incerto.length,
    },
    filmes_disponiveis: filmes.length,
    series_disponiveis: series.length,
    episodios_disponiveis: null,
    indisponiveis: removidos.length,
    reproducao_validada: true,
    motivo_nao_validado: null,
    filmes,
    series,
    falhas: incerto.map((r) => ({ tmdb_id: r.tmdb_id, type: r.type, motivo: r.motivo })),
  }

  const baseline = {
    _comentario:
      'Títulos ocultos. COMITADO de propósito: o plano Free da Velixir não tem volume ' +
      'persistente, então o que foi removido precisa viajar com o código para valer no ' +
      'deploy seguinte. Gerado por scripts/gerar-catalogo-verificado.mjs a partir da ' +
      'verificação real de cada título.',
    gerado_em: agora,
    total_oculto: removidos.length,
    hidden: removidos.map((r) => ({
      tmdb_id: r.tmdb_id,
      type: r.type,
      title: r.title,
      poster_url: r.poster_url,
      motivo: r.motivo,
      origem: 'verificacao-real',
      em: agora,
    })),
  }

  console.log(
    `[gerar] testados=${all.length} funciona=${funciona.length} ` +
      `sem_fonte=${semFonte.length} incerto=${incerto.length}`,
  )
  console.log(`[gerar] filmes=${filmes.length} series=${series.length} removidos=${removidos.length}`)

  if (DRY) {
    console.log('[gerar] --dry: nada foi escrito')
    return
  }

  await fs.writeFile(
    path.join(ROOT, 'public', 'filmes', 'megaembed-disponibilidade.json'),
    JSON.stringify(disponibilidade, null, 0),
  )
  await fs.writeFile(
    path.join(ROOT, 'server', 'data', 'hidden-baseline.json'),
    JSON.stringify(baseline, null, 2),
  )

  const docDir = path.join(ROOT, 'documents', 'limpeza-catalogo')
  await fs.mkdir(docDir, { recursive: true })
  await fs.writeFile(
    path.join(docDir, 'removidos.json'),
    JSON.stringify({ gerado_em: agora, total: removidos.length, itens: removidos }, null, 2),
  )
  const csv = [
    'tmdb_id,tipo,titulo,ano,motivo',
    ...removidos.map((r) =>
      [r.tmdb_id, r.type, `"${String(r.title).replace(/"/g, '""')}"`, r.year, `"${r.motivo}"`].join(','),
    ),
  ].join('\n')
  await fs.writeFile(path.join(docDir, 'removidos.csv'), csv)

  console.log('[gerar] escrito: megaembed-disponibilidade.json, hidden-baseline.json, removidos.json/csv')
}

main().catch((e) => {
  console.error('[gerar] falhou:', e?.message ?? e)
  process.exitCode = 1
})
