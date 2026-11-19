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

console.log('\n[build] concluído')
