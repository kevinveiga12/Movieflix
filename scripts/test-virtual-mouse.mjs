#!/usr/bin/env node
/**
 * Testes do MOUSE VIRTUAL do player (lógica pura, sem navegador).
 *
 *   node scripts/test-virtual-mouse.mjs
 *
 * ── O que isto prova ─────────────────────────────────────────────────────────
 *
 * A lógica que decide "segurar OK 2 s liga o mouse", "o direcional move o
 * cursor", "o cursor não sai da tela" e "desligado o direcional não move" vive
 * em `src/lib/virtualMouse.ts`, sem React e sem DOM. Aqui ela é compilada e
 * exercitada de verdade — se alguém quebrar a regra, este teste falha.
 *
 * O clique (`clickAtRatio`) é testado contra um DOM falso mínimo, para provar
 * que a fração da tela vira a coordenada certa e que os quatro eventos de mouse
 * são despachados no elemento que está naquele ponto.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '..', 'src', 'lib', 'virtualMouse.ts')

let checks = 0
let failures = 0
function check(name, cond, detail = '') {
  checks++
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a, b) => Math.abs(a - b) < 0.001

// ── 1. Compilar o TypeScript para ESM e importar ─────────────────────────────
const source = fs.readFileSync(SRC, 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText

const tmp = path.join(__dirname, '.virtualMouse.test.mjs')
fs.writeFileSync(tmp, js)
const mod = await import(`file://${tmp}?v=${Date.now()}`)
fs.unlinkSync(tmp)

const { VirtualMouse, HoldDetector, clickAtRatio, HOLD_MS, STEP_PX } = mod

console.log('MovieFlix — mouse virtual do controle remoto')
console.log('='.repeat(60))

// ── 2. Constantes da regra do proprietário ───────────────────────────────────
console.log('\n[1] Regra: segurar OK por 2 s')
check('HOLD_MS é 2000 ms', HOLD_MS === 2000, `HOLD_MS=${HOLD_MS}`)
check('passo do cursor é positivo', STEP_PX > 0, `STEP_PX=${STEP_PX}`)

// ── 3. Detector de segurar ───────────────────────────────────────────────────
console.log('\n[2] Detector de segurar OK')
{
  const h = new HoldDetector(2000)
  h.onDown(10_000)
  check('não dispara antes de 2 s', h.tick(11_900) === null)
  check('dispara hold exatamente em 2 s', h.tick(12_000) === 'hold')
  check('hold só dispara uma vez', h.tick(12_500) === null)
  check('soltar depois do hold não gera toque curto', h.onUp() === null)

  const h2 = new HoldDetector(2000)
  h2.onDown(20_000)
  check('toque curto não dispara hold', h2.tick(20_500) === null)
  check('toque curto devolve short ao soltar', h2.onUp() === 'short')

  const h3 = new HoldDetector(2000)
  h3.onDown(30_000)
  h3.cancel()
  check('cancel limpa o estado', h3.tick(40_000) === null && h3.onUp() === 'short')
}

// ── 4. Estado do mouse ───────────────────────────────────────────────────────
console.log('\n[3] Estado do mouse: ligar, mover, limites')
{
  const m = new VirtualMouse(28)
  m.setBounds(1920, 1080)
  check('mouse nasce desligado', m.active === false)
  check('cursor nasce no centro (x)', near(m.x, 960), `x=${m.x}`)
  check('cursor nasce no centro (y)', near(m.y, 540), `y=${m.y}`)

  m.move(1, 0)
  check('desligado: direcional NÃO move', near(m.x, 960), `x=${m.x}`)

  m.toggle()
  check('segurar OK liga o mouse', m.active === true)

  m.move(1, 0)
  check('ligado: direita soma um passo', near(m.x, 988), `x=${m.x}`)
  m.move(-1, 0)
  check('ligado: esquerda volta um passo', near(m.x, 960), `x=${m.x}`)
  m.move(0, -1)
  check('ligado: cima sobe um passo', near(m.y, 512), `y=${m.y}`)
  m.move(0, 1)
  check('ligado: baixo desce um passo', near(m.y, 540), `y=${m.y}`)

  for (let i = 0; i < 200; i++) m.move(1, 0)
  check('cursor para na borda direita', near(m.x, 1920), `x=${m.x}`)
  for (let i = 0; i < 200; i++) m.move(0, 1)
  check('cursor para na borda inferior', near(m.y, 1080), `y=${m.y}`)
  for (let i = 0; i < 400; i++) m.move(-1, -1)
  check('cursor para no canto superior esquerdo', near(m.x, 0) && near(m.y, 0), `x=${m.x} y=${m.y}`)

  check('ratioX no canto = 0', near(m.ratioX(), 0))
  check('ratioY no canto = 0', near(m.ratioY(), 0))

  m.toggle()
  check('segurar OK de novo desliga o mouse', m.active === false)
  const before = m.x
  m.move(1, 0)
  check('desligado de novo: direcional não move', near(m.x, before))
}

// ── 5. Redimensionar a tela ──────────────────────────────────────────────────
console.log('\n[4] Redimensionar mantém o cursor dentro da tela')
{
  const m = new VirtualMouse(28)
  m.setBounds(1920, 1080)
  m.toggle()
  for (let i = 0; i < 100; i++) m.move(1, 1)
  check('cursor no canto antes de encolher', near(m.x, 1920) && near(m.y, 1080))

  m.setBounds(800, 600)
  check('encolher a tela puxa o cursor para dentro (x)', m.x <= 800, `x=${m.x}`)
  check('encolher a tela puxa o cursor para dentro (y)', m.y <= 600, `y=${m.y}`)
  check('ratio continua válido', m.ratioX() <= 1 && m.ratioY() <= 1)
}

// ── 6. Clique na posição do cursor ───────────────────────────────────────────
console.log('\n[5] Clique: fração da tela → coordenada → eventos no elemento')
{
  const events = []
  const target = {
    dispatchEvent: (ev) => {
      events.push(ev)
      return true
    },
  }
  const doc = { elementFromPoint: (x, y) => ({ ...target, _x: x, _y: y }) }
  const win = { innerWidth: 1920, innerHeight: 1080 }

  // MouseEvent não existe no Node: stub mínimo com as mesmas propriedades.
  globalThis.MouseEvent = class {
    constructor(type, opts) {
      this.type = type
      Object.assign(this, opts || {})
    }
  }

  const el = clickAtRatio(doc, win, 0.5, 0.5)
  check('devolve o elemento clicado', Boolean(el))
  check('despacha 4 eventos (move/down/up/click)', events.length === 4, `n=${events.length}`)
  check('eventos na ordem certa', events.map((e) => e.type).join(',') === 'mousemove,mousedown,mouseup,click')
  check('clique no centro (x=960)', events[0].clientX === 960, `x=${events[0].clientX}`)
  check('clique no centro (y=540)', events[0].clientY === 540, `y=${events[0].clientY}`)
  check('eventos borbulham', events.every((e) => e.bubbles === true))

  events.length = 0
  clickAtRatio(doc, win, 0, 0)
  check('canto superior esquerdo → (0,0)', events[0].clientX === 0 && events[0].clientY === 0)

  events.length = 0
  clickAtRatio(doc, win, 1, 1)
  check('canto inferior direito → (1920,1080)', events[0].clientX === 1920 && events[0].clientY === 1080)

  check('fração inválida não clica', clickAtRatio(doc, win, NaN, 0.5) === null)
  check('sem elemento no ponto não clica', clickAtRatio({ elementFromPoint: () => null }, win, 0.5, 0.5) === null)
}

console.log('\n' + '='.repeat(60))
console.log(`${checks} verificações, ${failures} falha(s)`)
if (failures > 0) {
  console.log('RESULTADO: FALHOU')
  process.exit(1)
}
console.log('RESULTADO: PASSOU')
