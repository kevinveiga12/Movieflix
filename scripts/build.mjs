#!/usr/bin/env node
/**
 * Build de produção do MovieFlix.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ──────────────────────────────────────────────
 *
 * O runtime roda com `NODE_OPTIONS=--max-old-space-size=160` para caber nos
 * 256 MB do plano Free da Velixir (ver nixpacks.toml → [start]). Esse mesmo
 * `NODE_OPTIONS` é herdado pela fase de BUILD, e o build NÃO cabe em 160 MB:
 *
 *   medido neste repositório (heap usado no pico):
 *     tsc -b        → ~193 MB
 *     vite build    → ~193 MB
 *
 * Com o teto de 160 MB o processo morre com
 *   "Reached heap limit Allocation failed - JavaScript heap out of memory"
 * e a Velixir reporta "The build failed".
 *
 * ── POR QUE NÃO BASTA O nixpacks.toml ────────────────────────────────────────
 *
 * A Velixir não lê o nixpacks.toml para a fase de build (ela detecta o projeto
 * e roda `npm run build`). Então o teto precisa ser definido AQUI, no próprio
 * script que o builder executa — assim funciona em qualquer host, com ou sem
 * nixpacks, e independente do `NODE_OPTIONS` que o ambiente já traga.
 *
 * O teto do build (1024 MB) não vaza para o runtime: são processos diferentes.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

// `require.resolve` dentro de um .mjs precisa do require do módulo.
const require = createRequire(import.meta.url)

const BUILD_HEAP_MB = '1024'

// Sobrescreve o NODE_OPTIONS herdado (que pode trazer --max-old-space-size=160).
const env = { ...process.env, NODE_OPTIONS: `--max-old-space-size=${BUILD_HEAP_MB}` }

/**
 * Garante que as ferramentas de build existam.
 *
 * Se o builder rodou `npm ci` com NODE_ENV=production (ou sem --include=dev),
 * typescript e vite não foram instalados e o build morreria com
 * "sh: 1: tsc: not found". Aqui a falta é detectada e as devDependencies são
 * instaladas antes de seguir — o build nunca falha por causa disso.
 */
function ensureDevTools() {
  const need = ['typescript', 'vite']
  const missing = need.filter((p) => {
    try {
      require.resolve(`${p}/package.json`, { paths: [process.cwd()] })
      return false
    } catch {
      return true
    }
  })
  if (missing.length === 0) return
  console.log(`\n[build] devDependencies ausentes (${missing.join(', ')}) — instalando`)
  const r = spawnSync('npm', ['install', '--include=dev', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
    env,
    shell: false,
  })
  if (r.status !== 0) {
    console.error('[build] falha ao instalar as devDependencies')
    process.exit(r.status ?? 1)
  }
}

function run(label, cmd, args) {
  console.log(`\n[build] ${label}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: false })
  if (r.error) {
    console.error(`[build] falha ao executar ${cmd}: ${r.error.message}`)
    process.exit(1)
  }
  if (r.status !== 0) {
    console.error(`[build] ${label} saiu com código ${r.status}`)
    process.exit(r.status ?? 1)
  }
}

ensureDevTools()

// 1. Checagem de tipos (gera os .tsbuildinfo usados pelo vite).
run('tsc -b', 'npx', ['tsc', '-b'])

// 2. Bundle de produção.
run('vite build', 'npx', ['vite', 'build'])

/**
 * 3. Catálogo pré-comprimido.
 *
 * O Vite copia `public/` para `dist/`, então os JSONs do catálogo chegam lá
 * crus (15 MB + 8 MB). O servidor entrega o `.gz` ao lado quando o cliente
 * aceita gzip (ver server/index.js), o que derruba o download de ~13 s para
 * ~1,4 s. Gerar aqui, no build, evita comprimir a cada requisição — que era
 * justamente o pico de memória que derrubava o pod.
 */
function gzipCatalog() {
  const dir = path.join(process.cwd(), 'dist', 'filmes')
  if (!fs.existsSync(dir)) {
    console.log('[build] dist/filmes ausente — nada a comprimir')
    return
  }
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const src = path.join(dir, name)
    const out = `${src}.gz`
    const raw = fs.readFileSync(src)
    const gz = zlib.gzipSync(raw, { level: 9 })
    fs.writeFileSync(out, gz)
    console.log(
      `[build] ${name}: ${(raw.length / 1048576).toFixed(1)} MB → ${(gz.length / 1048576).toFixed(2)} MB`,
    )
  }
}

gzipCatalog()

console.log('\n[build] concluído')
