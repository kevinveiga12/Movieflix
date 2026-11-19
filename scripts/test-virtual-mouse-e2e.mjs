#!/usr/bin/env node
/**
 * E2E do MOUSE VIRTUAL em navegador real (Chromium/Playwright).
 *
 *   node scripts/test-virtual-mouse-e2e.mjs
 *
 * ── O que isto prova ─────────────────────────────────────────────────────────
 *
 * O teste de unidade (test-virtual-mouse.mjs) prova a lógica. Este prova o que
 * só um navegador de verdade mostra:
 *
 *   • segurar OK por 2 s liga o mouse (e o cursor aparece na tela);
 *   • segurar de novo desliga (e o cursor some);
 *   • com o mouse ligado, o direcional move o cursor de fato;
 *   • OK clica no elemento que está sob o cursor — aqui, um botão que conta
 *     cliques, provando que o clique chega ao DOM e não ao cursor;
 *   • com o mouse desligado, o direcional NÃO move o cursor (navegação normal).
 *
 * A página de teste usa o MÓDULO REAL (`src/lib/virtualMouse.ts`, transpilado),
 * não uma cópia: se a regra mudar, o teste acompanha.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { chromium } from 'playwright'

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

const moduleJs = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText

// O `setContent` roda em about:blank, onde `import ... from '/mod.js'` não
// resolve. Embutimos o módulo INLINE: trocamos `export ` por vazio e colamos o
// corpo no script da página. O código é o MESMO arquivo de produção.
const inlineModule = moduleJs
  .split('\n')
  .map((l) => (l.startsWith('export ') ? l.slice('export '.length) : l))
  .join('\n')

const browser = await chromium.launch({
  executablePath:
    process.env.PW_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1181/chrome-linux/headless_shell',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#000}
  #btn{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
       width:200px;height:80px;background:#e11;color:#fff;border:0;font-size:20px}
  .tv-cursor{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;
       border-radius:50%;background:#fff;pointer-events:none;z-index:60}
</style></head><body>
  <button id="btn">alvo</button>
  <div id="cursor" class="tv-cursor" style="display:none"></div>
  <script>
    ${inlineModule}
    const mouse = new VirtualMouse()
    const hold = new HoldDetector()
    mouse.setBounds(window.innerWidth, window.innerHeight)
    const cursor = document.getElementById('cursor')
    const btn = document.getElementById('btn')
    let clicks = 0
    btn.addEventListener('click', () => { clicks++ })
    window.__state = () => ({
      active: mouse.active, x: mouse.x, y: mouse.y, clicks,
      cursorVisible: cursor.style.display !== 'none',
    })
    function paint() {
      cursor.style.display = mouse.active ? 'block' : 'none'
      cursor.style.left = (mouse.ratioX() * 100) + '%'
      cursor.style.top = (mouse.ratioY() * 100) + '%'
    }
    paint()
    const isOk = (k) => ['Enter',' ','MediaPlayPause'].includes(k)
    window.addEventListener('keydown', (e) => {
      if (isOk(e.key)) {
        // SEMPRE começa a contar o "segurar 2 s" — com o mouse ligado ou não.
        if (!e.repeat) hold.onDown(performance.now())
        return
      }
      if (e.key === 'ArrowLeft') { if (mouse.active) { mouse.move(-1,0); paint() } return }
      if (e.key === 'ArrowRight') { if (mouse.active) { mouse.move(1,0); paint() } return }
      if (e.key === 'ArrowUp') { if (mouse.active) { mouse.move(0,-1); paint() } return }
      if (e.key === 'ArrowDown') { if (mouse.active) { mouse.move(0,1); paint() } return }
    })
    window.addEventListener('keyup', (e) => {
      if (!isOk(e.key)) return
      // Toque curto: com o mouse ligado é clique na posição do cursor;
      // desligado é a ação normal (aqui, nada — o teste mede o clique).
      if (hold.onUp() === 'short' && mouse.active) {
        clickAtRatio(document, window, mouse.ratioX(), mouse.ratioY())
        paint()
      }
    })
    setInterval(() => {
      if (hold.tick(performance.now()) === 'hold') { mouse.toggle(); paint() }
    }, 50)
  </script>
</body></html>`)

await page.waitForFunction(() => typeof window.__state === 'function')

const state = () => page.evaluate(() => window.__state())

console.log('MovieFlix — mouse virtual (E2E em Chromium)')
console.log('='.repeat(60))

// ── 1. Estado inicial ────────────────────────────────────────────────────────
console.log('\n[1] Estado inicial')
{
  const s = await state()
  check('mouse começa desligado', s.active === false)
  check('cursor começa escondido', s.cursorVisible === false)
  check('cursor começa no centro (x)', Math.abs(s.x - 640) < 1, `x=${s.x}`)
  check('cursor começa no centro (y)', Math.abs(s.y - 360) < 1, `y=${s.y}`)
}

// ── 2. Desligado: direcional não move ────────────────────────────────────────
console.log('\n[2] Desligado: navegação convencional preservada')
{
  const before = await state()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  const after = await state()
  check('direcional não move o cursor', after.x === before.x && after.y === before.y)
}

// ── 3. Segurar OK 2 s liga o mouse ───────────────────────────────────────────
console.log('\n[3] Segurar OK por 2 s liga o mouse')
{
  await page.keyboard.down('Enter')
  await page.waitForTimeout(1_200)
  const mid = await state()
  check('antes de 2 s o mouse continua desligado', mid.active === false)

  await page.waitForTimeout(1_200)
  const on = await state()
  check('aos 2 s o mouse liga', on.active === true)
  check('o cursor aparece na tela', on.cursorVisible === true)
  await page.keyboard.up('Enter')
}

// ── 4. Direcional move o cursor ──────────────────────────────────────────────
console.log('\n[4] Ligado: direcional move o cursor')
{
  const before = await state()
  await page.keyboard.press('ArrowRight')
  const right = await state()
  check('direita move o cursor para a direita', right.x > before.x, `${before.x} → ${right.x}`)

  await page.keyboard.press('ArrowDown')
  const down = await state()
  check('baixo move o cursor para baixo', down.y > right.y, `${right.y} → ${down.y}`)

  await page.keyboard.press('ArrowLeft')
  const left = await state()
  check('esquerda move o cursor para a esquerda', left.x < down.x, `${down.x} → ${left.x}`)

  await page.keyboard.press('ArrowUp')
  const up = await state()
  check('cima move o cursor para cima', up.y < left.y, `${left.y} → ${up.y}`)
}

// ── 5. OK clica no elemento sob o cursor ─────────────────────────────────────
console.log('\n[5] Ligado: OK clica no elemento sob o cursor')
{
  // Leva o cursor até o centro, onde está o botão.
  const s0 = await state()
  const stepsX = Math.round((640 - s0.x) / 28)
  const stepsY = Math.round((360 - s0.y) / 28)
  for (let i = 0; i < Math.abs(stepsX); i++) {
    await page.keyboard.press(stepsX > 0 ? 'ArrowRight' : 'ArrowLeft')
  }
  for (let i = 0; i < Math.abs(stepsY); i++) {
    await page.keyboard.press(stepsY > 0 ? 'ArrowDown' : 'ArrowUp')
  }
  const centered = await state()
  check('cursor chegou perto do centro', Math.abs(centered.x - 640) <= 28 && Math.abs(centered.y - 360) <= 28,
    `x=${centered.x} y=${centered.y}`)

  const before = centered.clicks
  await page.keyboard.press('Enter')
  const after = await state()
  check('OK clicou no botão sob o cursor', after.clicks === before + 1, `clicks=${after.clicks}`)
  check('o clique não desligou o mouse', after.active === true)
}

// ── 6. Segurar OK de novo desliga ────────────────────────────────────────────
console.log('\n[6] Segurar OK de novo desliga o mouse')
{
  await page.keyboard.down('Enter')
  await page.waitForTimeout(2_300)
  const off = await state()
  check('aos 2 s o mouse desliga', off.active === false)
  check('o cursor some da tela', off.cursorVisible === false)
  await page.keyboard.up('Enter')

  const before = await state()
  await page.keyboard.press('ArrowRight')
  const after = await state()
  check('desligado: direcional não move mais', after.x === before.x)
}

// ── 7. Sem erros de JS ───────────────────────────────────────────────────────
console.log('\n[7] Console limpo')
check('nenhum erro de JavaScript na página', errors.length === 0, errors.join(' | '))

await browser.close()

console.log('\n' + '='.repeat(60))
console.log(`${checks} verificações, ${failures} falha(s)`)
if (failures > 0) {
  console.log('RESULTADO: FALHOU')
  process.exit(1)
}
console.log('RESULTADO: PASSOU')
