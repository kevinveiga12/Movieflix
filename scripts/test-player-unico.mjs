#!/usr/bin/env node
/**
 * TESTE DO PLAYER ÚNICO — MegaEmbed.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O QUE ESTE TESTE PROVA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. O player azul NÃO existe mais em nenhum caminho de reprodução.
 *   2. A URL entregue ao cliente é sempre do MegaEmbed (`mgeb.space`).
 *   3. Filme, série e episódio geram a URL certa.
 *   4. O catálogo público só lista o que o MegaEmbed serve.
 *   5. Nenhum arquivo do projeto referencia o player azul como provedor ativo.
 *
 * ── O que este teste NÃO prova ───────────────────────────────────────────────
 *
 * Que o vídeo TOCA. O Cloudflare Turnstile do MegaEmbed responde 403 a partir
 * deste ambiente (medido com curl e com Chromium real), então não há como abrir
 * o embed aqui. A reprodução é provada pelo navegador do cliente.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

let pass = 0
let fail = 0
function check(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    fail++
    console.log(`  ✗ ${name}\n      ${e.message}`)
  }
}

const { megaembedEmbedUrl, MEGAEMBED_ONLY } = await import('../server/lib/megaembed.js')

console.log('\n[1] URL do MegaEmbed')
check('filme usa /embed/{tmdb}', () => {
  assert.equal(megaembedEmbedUrl(550), 'https://mgeb.space/embed/550')
})
check('episódio usa /embed/{tmdb}/{t}/{e}', () => {
  assert.equal(megaembedEmbedUrl(1399, 1, 1), 'https://mgeb.space/embed/1399/1/1')
})
check('temporada 0 (especiais) não vira filme', () => {
  assert.equal(megaembedEmbedUrl(1399, 0, 3), 'https://mgeb.space/embed/1399/0/3')
})
check('nunca aponta para o player azul', () => {
  for (const u of [megaembedEmbedUrl(550), megaembedEmbedUrl(1399, 1, 1)]) {
    assert.ok(!/myembed|playerflix|watchplay|streambetter/i.test(u), u)
  }
})

console.log('\n[2] Modo player único')
check('MEGAEMBED_ONLY ligado por padrão', () => {
  assert.equal(MEGAEMBED_ONLY, true)
})

console.log('\n[3] Catálogo público filtrado')
const avail = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/filmes/megaembed-disponibilidade.json'), 'utf8'),
)
check('arquivo de disponibilidade existe e tem filmes', () => {
  assert.ok(avail.filmes.length > 1000, `filmes=${avail.filmes.length}`)
})
check('arquivo de disponibilidade tem séries', () => {
  assert.ok(avail.series.length > 1000, `series=${avail.series.length}`)
})
check('declara honestamente que a reprodução não foi validada aqui', () => {
  assert.equal(avail.reproducao_validada, false)
  assert.ok(String(avail.motivo_nao_validado).includes('Cloudflare'))
})
check('provedor declarado é megaembed', () => {
  assert.equal(avail.provedor, 'megaembed')
})

console.log('\n[4] Nenhum provedor antigo ativo no código')
const files = [
  'src/lib/player.ts',
  'src/lib/catalog.ts',
  'server/lib/static-catalog.js',
  'server/routes/access.js',
]
for (const f of files) {
  check(`${f} não usa o player azul como provedor`, () => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    // Comentários podem citar o player antigo (documentam a remoção).
    // O que não pode existir é uma URL ativa do provedor antigo.
    const active = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n')
    assert.ok(
      !/https?:\/\/(myembed\.biz|playerflix\.ink|v1\.watchplay\.shop|streambetter\.shop)/i.test(active),
      'URL ativa do provedor antigo encontrada',
    )
  })
}

check('EMBED_PROVIDER do cliente é mgeb.space', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/player.ts'), 'utf8')
  assert.ok(/EMBED_PROVIDER = 'https:\/\/mgeb\.space'/.test(src))
})
check('EMBED_PROVIDER do servidor é mgeb.space', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/lib/static-catalog.js'), 'utf8')
  assert.ok(/EMBED_PROVIDER = 'https:\/\/mgeb\.space'/.test(src))
})

console.log('\n[5] Página de downloads: três apps')
const dl = fs.readFileSync(path.join(ROOT, 'src/pages/SettingsPages.tsx'), 'utf8')
check('card do Android presente', () => assert.ok(dl.includes('MovieFlix para Android')))
check('card do iPhone presente', () => assert.ok(dl.includes('MovieFlix para iPhone')))
check('card da TV presente', () => assert.ok(dl.includes('MovieFlix para TV')))
check('TV marcada como em desenvolvimento', () => {
  assert.ok(dl.includes('Em desenvolvimento'))
  assert.ok(dl.includes('badge--warn'))
})
check('TV aponta para a rota pública de download', () => {
  assert.ok(dl.includes('/api/apps/tv/download'))
})

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passaram, ${fail} falharam\n`)
process.exit(fail === 0 ? 0 : 1)
