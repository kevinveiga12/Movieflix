#!/usr/bin/env node
/**
 * Gera o registro de reversibilidade da limpeza do catálogo.
 *
 * Compara o catálogo publicado (filmes.light.json / series.light.json) com a
 * lista que o provedor serve (megaembed-disponibilidade.json) e grava:
 *
 *   docs/limpeza-catalogo/removidos.json  — todos os títulos ocultos, com motivo
 *   docs/limpeza-catalogo/removidos.csv   — o mesmo, para abrir no Excel
 *   docs/limpeza-catalogo/RELATORIO.md    — resumo legível
 *
 * Nada é apagado dos JSON originais: o catálogo completo continua no repositório
 * e a limpeza é aplicada na LEITURA (filtro). Para reverter, basta apagar
 * `public/filmes/megaembed-disponibilidade.json` — site e API voltam a mostrar
 * tudo.
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public', 'filmes')
const OUT = path.join(ROOT, 'docs', 'limpeza-catalogo')

const movies = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'filmes.light.json'), 'utf8'))
const series = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'series.light.json'), 'utf8'))
const disp = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'megaembed-disponibilidade.json'), 'utf8'))

const okMovies = new Set((disp.filmes ?? []).map(String))
const okSeries = new Set((disp.series ?? []).map(String))

const MOTIVO =
  'título fora do catálogo oficial do provedor (MegaEmbed /api/movie e /api/series) — o embed não entrega fonte'

const removed = []
for (const m of movies) {
  const id = String(m.tmdb_id)
  if (okMovies.has(id)) continue
  removed.push({
    tipo: 'filme',
    tmdb_id: Number(id),
    titulo: m.title ?? '',
    ano: m.year ?? (m.release_date ? String(m.release_date).slice(0, 4) : ''),
    motivo: MOTIVO,
  })
}
for (const s of series) {
  const id = String(s.tmdb_id)
  if (okSeries.has(id)) continue
  removed.push({
    tipo: 'serie',
    tmdb_id: Number(id),
    titulo: s.title ?? '',
    ano: s.year ?? (s.release_date ? String(s.release_date).slice(0, 4) : ''),
    motivo: MOTIVO,
  })
}

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'removidos.json'), JSON.stringify(removed, null, 1))

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csv = [
  'tipo,tmdb_id,titulo,ano,motivo',
  ...removed.map((r) => [r.tipo, r.tmdb_id, esc(r.titulo), r.ano, esc(r.motivo)].join(',')),
].join('\n')
fs.writeFileSync(path.join(OUT, 'removidos.csv'), csv, 'utf8')

const totalMovies = movies.length
const totalSeries = series.length
const keptMovies = okMovies.size
const keptSeries = okSeries.size
const removedMovies = totalMovies - keptMovies
const removedSeries = totalSeries - keptSeries

const md = `# Limpeza do catálogo — títulos que não abrem o player

Gerado em ${new Date().toISOString()} a partir de
\`public/filmes/megaembed-disponibilidade.json\` (verificação de ${disp.gerado_em}).

## Números

| | Antes | Depois | Ocultos |
|---|---:|---:|---:|
| Filmes | ${totalMovies} | ${keptMovies} | ${removedMovies} |
| Séries | ${totalSeries} | ${keptSeries} | ${removedSeries} |
| **Total** | **${totalMovies + totalSeries}** | **${keptMovies + keptSeries}** | **${removedMovies + removedSeries}** |

## Por que foram ocultados

O player é o **MegaEmbed** (\`https://mgeb.space/embed/{tmdb_id}\`). Ele publica a
lista de TMDB IDs que serve:

- \`GET https://mgeb.space/api/movie\` → ${disp.catalogo_provedor?.filmes ?? '?'} IDs
- \`GET https://mgeb.space/api/series\` → ${disp.catalogo_provedor?.series ?? '?'} IDs

Um ID **fora** dessa lista não tem fonte no provedor: o embed abre sem vídeo.
Esses títulos foram ocultados do catálogo público.

## Limite honesto desta verificação

\`reproducao_validada: ${disp.reproducao_validada}\`.

O que foi provado: **o título existe no catálogo oficial do provedor** (a fonte
existe). O que **não** foi provado: que o vídeo inicia em cada aparelho — o
Cloudflare Turnstile do MegaEmbed responde 403 em todos os domínios
(\`mgeb.space\`, \`.lat\`, \`.casa\`, \`.quest\`) a partir do ambiente de build, medido
com curl e com Chromium real. A prova de reprodução só o player do cliente pode
dar.

## Como reverter

A limpeza é aplicada na **leitura**, não nos dados:

1. **Reverter tudo:** apague \`public/filmes/megaembed-disponibilidade.json\` e
   publique. Sem o arquivo, site e API voltam a mostrar o catálogo inteiro.
2. **Reverter um título:** adicione o \`tmdb_id\` à lista \`filmes\` (ou \`series\`)
   do \`megaembed-disponibilidade.json\` e publique.
3. **Reverter um grupo:** use \`removidos.csv\` para escolher os ids.

O catálogo completo (\`filmes.light.json\` / \`series.light.json\`) **nunca foi
alterado** — nenhum registro foi apagado.

## Arquivos

- \`removidos.json\` — lista completa (tipo, tmdb_id, título, ano, motivo)
- \`removidos.csv\` — a mesma lista em CSV
`

fs.writeFileSync(path.join(OUT, 'RELATORIO.md'), md, 'utf8')

console.log(`Ocultos: ${removedMovies} filmes + ${removedSeries} séries = ${removed.length}`)
console.log(`Mantidos: ${keptMovies} filmes + ${keptSeries} séries`)
console.log(`Gravado em ${OUT}`)
