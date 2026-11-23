/**
 * TESTE DE REGRESSÃO — o disjuntor não pode abrir por título ausente.
 *
 * ── O BUG QUE ESTE TESTE TRAVA (2026-11-23) ─────────────────────────────────
 *
 * O `playback-chain` chamava `record('watchplay', false)` sempre que o
 * resolvedor devolvia `null` — sem distinguir:
 *
 *   a) provedor fora do ar / bloqueado  → falha DELE
 *   b) título que o provedor não tem    → falha DO TÍTULO
 *
 * Com o limiar em 3, bastavam três títulos ausentes (o catálogo tem milhares)
 * para o disjuntor abrir e o `watchplay` ser PULADO por 5 minutos em TODOS os
 * títulos — inclusive nos que funcionam. O cliente via "Nenhuma fonte de
 * reprodução funcional disponível" na maior parte do catálogo.
 *
 * Este teste prova, com o módulo REAL (não uma cópia da lógica):
 *
 *   1. três títulos 404 NÃO abrem o disjuntor do watchplay;
 *   2. um título que existe continua resolvendo HLS depois disso;
 *   3. um host realmente inalcançável (simulado) ABRE o disjuntor.
 *
 * Uso: node scripts/test-breaker-titulo-ausente.mjs
 */

import { resolveDirectStreamDetailed, ajaxBreakerStatus } from '../server/lib/stream-resolver.js'
import { resolvePlaybackChain, breakerStatus as chainBreakers } from '../server/lib/playback-chain.js'

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name} ${detail}`)
  }
}

// IDs que sabidamente NÃO existem no provedor (404 medido).
const AUSENTES = [1668, 456, 1416]
// ID que sabidamente existe e entrega HLS (medido: 200 + #EXTM3U).
const EXISTE = 550

console.log('═══ 1) Título ausente NÃO é falha do provedor ═══')
for (const id of AUSENTES) {
  const r = await resolveDirectStreamDetailed({ tmdbId: id })
  check(
    `id ${id}: stream=null mas reachable=true`,
    r.stream === null && r.reachable === true,
    `→ stream=${r.stream} reachable=${r.reachable}`,
  )
}

console.log('\n═══ 2) Três títulos ausentes NÃO abrem o disjuntor ═══')
for (const id of AUSENTES) {
  await resolvePlaybackChain({ tmdbId: id })
}
const b = chainBreakers()
const wp = b.watchplay ?? { fails: 0, open: false }
check('disjuntor do watchplay continua FECHADO', wp.open === false, `→ ${JSON.stringify(wp)}`)
check('contador de falhas do watchplay é 0', (wp.fails ?? 0) === 0, `→ fails=${wp.fails}`)

console.log('\n═══ 3) Título que existe continua resolvendo depois disso ═══')
const chain = await resolvePlaybackChain({ tmdbId: EXISTE })
check('cadeia do filme 550 tem ao menos uma fonte', chain.length > 0, `→ ${chain.length} fontes`)
check(
  'a primeira fonte é HLS direto (player nosso, sem anúncio)',
  chain[0]?.mode === 'direct',
  `→ mode=${chain[0]?.mode}`,
)

console.log('\n═══ 4) Host realmente inalcançável ABRE o disjuntor ═══')
// Aponta o resolvedor para um host que não resolve: simula o playerflix
// bloqueado. O disjuntor DEVE abrir — é o caso legítimo.
const origFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('playerflix.ink')) throw new Error('ENOTFOUND simulado')
  return origFetch(url, opts)
}
try {
  for (let i = 0; i < 4; i++) {
    await resolveDirectStreamDetailed({ tmdbId: 999000 + i })
  }
} finally {
  globalThis.fetch = origFetch
}
const b2 = ajaxBreakerStatus()
check(
  'disjuntor do Ajax abriu com host inalcançável',
  b2.open === true || b2.fails >= 3,
  `→ ${JSON.stringify(b2)}`,
)

console.log(`\n═══ RESULTADO: ${pass} passaram, ${fail} falharam ═══`)
process.exit(fail ? 1 : 0)
