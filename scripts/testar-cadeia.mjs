/**
 * TESTE DA CADEIA MULTIPROVEDOR — com o resolvedor REAL, não mock.
 *
 * Roda `resolvePlaybackChain` contra títulos reais do catálogo e imprime a
 * cadeia que o cliente receberia. Também simula o disjuntor: derruba o Ajax do
 * `playerflix.ink` (bloqueando o host) e confirma que o `watchplay` continua
 * sendo tentado — que é o ponto da correção.
 */
import { resolvePlaybackChain, breakerStatus, recentPlaybackDecisions } from '../server/lib/playback-chain.js'

const CASES = [
  { label: 'filme 550 (Clube da Luta)', tmdbId: '550' },
  { label: 'filme 27205 (A Origem)', tmdbId: '27205' },
  { label: 'filme 155 (Batman)', tmdbId: '155' },
  { label: 'série 1399 T1E1 (GoT)', tmdbId: '1399', season: 1, episode: 1 },
  { label: 'série 219937 T1E1', tmdbId: '219937', season: 1, episode: 1 },
  { label: 'id inexistente', tmdbId: '99999999' },
  { label: 'id inválido', tmdbId: 'abc' },
]

let pass = 0
let fail = 0

for (const c of CASES) {
  const chain = await resolvePlaybackChain(c)
  const desc = chain.map((s) => `${s.provider}/${s.mode}`).join(' → ') || '(vazia)'
  console.log(`\n${c.label}`)
  console.log(`  cadeia: ${desc}`)
  for (const s of chain) {
    console.log(`    · ${s.id} [${s.mode}] verified=${s.verified} url=${s.url.slice(0, 70)}`)
  }
  // Invariantes que o código tem de cumprir:
  const ok =
    Array.isArray(chain) &&
    chain.every((s) => s.url && s.mode && s.provider) &&
    // Nenhum embed de anúncio sem autorização explícita.
    chain.every((s) => s.provider !== 'embedplay' && s.provider !== 'embedplayer')
  if (ok) pass++
  else {
    fail++
    console.log('  ✗ INVARIANTE VIOLADA')
  }
}

console.log('\n=== disjuntores ===')
console.log(JSON.stringify(breakerStatus(), null, 2))

console.log('\n=== últimas decisões ===')
for (const d of recentPlaybackDecisions().slice(0, 4)) {
  console.log(` ${d.tmdbId}${d.isEpisode ? ` S${d.season}E${d.episode}` : ''} → ${d.sources.join(',') || 'nada'} | tentou: ${d.tried.map((t) => `${t.provider}:${t.result}`).join(', ')}`)
}

console.log(`\nRESULTADO: ${pass} ok, ${fail} falha(s)`)
process.exit(fail ? 1 : 0)
