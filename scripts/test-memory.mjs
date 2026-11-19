// Mede a memória do servidor sob carga e confirma que ela NÃO cresce sem limite.
//
//   node scripts/test-memory.mjs [baseURL]
//
// Dispara rajadas de requisições nas rotas mais pesadas (catálogo, capas,
// busca) e compara o RSS antes/depois. Falha se o RSS crescer mais que o teto
// configurado — sinal de vazamento.
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
const ROUNDS = 4
const PER_ROUND = 25

async function health() {
  // O rate limit global é 240/min. Se bater 429, espera a janela e tenta de novo.
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch(`${BASE}/api/health`)
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 15_000))
      continue
    }
    const j = await r.json()
    if (!j?.memory) throw new Error(`health sem memory (status ${r.status})`)
    return j
  }
  throw new Error('health continuou 429 após várias tentativas')
}

async function hit(path) {
  try {
    const r = await fetch(`${BASE}${path}`)
    await r.arrayBuffer()
  } catch {
    /* ignora erro de rede pontual */
  }
}

const paths = [
  '/api/catalog?limit=60',
  '/api/catalog?q=matrix',
  '/api/catalog/genres',
  '/api/catalog/posters?ids=550,551,552,553,554,555',
  '/api/health',
]

const before = await health()
console.log(`RSS inicial: ${before.memory.rssMb} MB · heap ${before.memory.heapUsedMb} MB`)

for (let round = 1; round <= ROUNDS; round++) {
  const batch = []
  for (let i = 0; i < PER_ROUND; i++) batch.push(hit(paths[i % paths.length]))
  await Promise.all(batch)
  // Espera a janela do rate limit (60 s) respirar entre rodadas.
  await new Promise((r) => setTimeout(r, 20_000))
  const h = await health()
  console.log(`  rodada ${round}: rss ${h.memory.rssMb} MB · heap ${h.memory.heapUsedMb} MB`)
}

// Deixa o GC agir e mede de novo.
await new Promise((r) => setTimeout(r, 3000))
const after = await health()
const growth = after.memory.rssMb - before.memory.rssMb
console.log(`\nRSS final: ${after.memory.rssMb} MB (cresceu ${growth} MB em ${ROUNDS * PER_ROUND} requisições)`)

const LIMIT_MB = 60
const ok = growth <= LIMIT_MB
console.log(ok ? `OK: crescimento ${growth} MB ≤ ${LIMIT_MB} MB` : `FALHOU: crescimento ${growth} MB > ${LIMIT_MB} MB`)
process.exit(ok ? 0 : 1)
