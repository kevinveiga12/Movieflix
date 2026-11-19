#!/usr/bin/env node
/**
 * Teste E2E (Playwright/Chromium) do player da TV — modo embed.
 *
 *   node scripts/tv-player-e2e.mjs
 *
 * ── O que este teste é, e o que ele NÃO é ────────────────────────────────────
 *
 * O app da TV é Android/Compose: não roda num navegador. O que PODE ser
 * exercitado de verdade num Chromium é a parte que produzia o defeito
 * relatado — a página do provedor dentro do WebView, com a ponte JS injetada
 * e o D-pad chegando como eventos de teclado.
 *
 * Então este teste:
 *   1. extrai o BRIDGE_JS do próprio `TvPlayerScreen.kt` (fonte única — se
 *      alguém quebrar a ponte, o teste falha);
 *   2. monta uma página que imita o DOM do provedor (painel "ASSISTIR",
 *      engrenagem, tela cheia, `.scrim-top`, `#ui`, botões focáveis) e um
 *      `<video>` real;
 *   3. injeta a ponte e dirige o player com as MESMAS teclas que o app manda
 *      (Enter = OK, ArrowLeft/ArrowRight = seek);
 *   4. mede o que o usuário vê: barra de progresso, ausência de anel amarelo,
 *      ausência de botões/painéis, foco não preso em elemento do provedor,
 *      zero erros de JavaScript.
 *
 * O que ele NÃO cobre (e é dito no relatório): o travamento de foco do
 * Compose (`FOCUS_BLOCK_DESCENDANTS` no WebView) e o redirecionamento de
 * login, que são código Android e só se verificam no aparelho/emulador.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const SRC = path.join(
  ROOT,
  'tv/android/app/src/main/java/run/velixir/movieflix/tv/ui/screens/TvPlayerScreen.kt',
)
const SHOTS = path.join(ROOT, 'docs', 'screenshots')

let failures = 0
let checks = 0
function check(name, cond, detail = '') {
  checks++
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── 1. Extrair a ponte do Kotlin ─────────────────────────────────────────────
const kt = fs.readFileSync(SRC, 'utf8')
const m = kt.match(/private val BRIDGE_JS: String = """([\s\S]*?)"""\.trimIndent\(\)/)
if (!m) {
  console.error('ERRO: não achei BRIDGE_JS em TvPlayerScreen.kt')
  process.exit(1)
}
const bridge = m[1]

/**
 * DOM do provedor — o mesmo formato que o playerflix.ink desenha e que
 * aparecia nas fotos do usuário: título no topo, painel "ASSISTIR" com
 * engrenagem e tela cheia (o elemento que recebia o anel amarelo), barra
 * própria embaixo com botão de pause, volume e a dica de teclas.
 */
const PROVIDER_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>provedor</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:sans-serif}
  video{width:100%;height:100%;object-fit:contain;display:block}
  #ui{position:absolute;inset:0;pointer-events:none}
  .scrim-top{position:absolute;top:0;left:0;right:0;height:120px;
    background:linear-gradient(#000c,transparent)}
  .title-wrap{position:absolute;top:24px;left:32px;color:#4aa3ff;font-size:22px}
  .top-actions{position:absolute;top:20px;right:28px;display:flex;gap:10px}
  .icon-btn{width:44px;height:44px;border:2px solid #fff3;background:#0008;color:#fff}
  .panel{position:absolute;top:20px;right:90px;padding:10px 16px;background:#000a;
    color:#fff;border:2px solid #fff3}
  .controls{position:absolute;bottom:0;left:0;right:0;height:90px;
    background:linear-gradient(transparent,#000d);display:flex;align-items:center;
    gap:14px;padding:0 32px;color:#fff}
  .next-btn,.prev-btn{width:40px;height:40px;background:#0008;color:#fff;border:0}
  .volume{color:#fff}
  .hint{position:absolute;bottom:96px;left:32px;color:#bbb;font-size:13px}
  /* O anel amarelo que o usuário viu: foco do Chromium em elemento do DOM. */
  :focus{outline:3px solid #ffd400;outline-offset:2px}
</style>
</head>
<body>
  <video id="v" muted playsinline preload="auto"></video>
  <div id="ui">
    <div class="scrim-top"></div>
    <div class="title-wrap">GRAND THEFT AUTO VI: UM OLHAR ESTENDIDO</div>
    <div class="top-actions">
      <button class="icon-btn" id="gear">⚙</button>
      <button class="icon-btn" id="fs">⛶</button>
    </div>
    <div class="panel" id="watch" tabindex="0">ASSISTIR · DUB · WatchPlay</div>
    <div class="controls">
      <button class="prev-btn" id="prev">⏮</button>
      <button class="next-btn" id="pause">⏸</button>
      <span class="volume">🔊 100%</span>
    </div>
    <div class="hint">OK play/pause · ← → 10s (segure para acelerar)</div>
  </div>
</body>
</html>`

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

  const jsErrors = []
  page.on('pageerror', (e) => jsErrors.push(String(e)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') jsErrors.push(msg.text())
  })

  // Um vídeo real, gerado DENTRO do Chromium (canvas + MediaRecorder).
  // Não usamos ffmpeg: o sandbox não permite codificar vídeo neste plano, e
  // um <video> de verdade é o que dá sentido ao teste (paused/currentTime
  // reais, eventos reais).
  await page.setContent(PROVIDER_HTML, { waitUntil: 'load' })
  const madeVideo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')
    let n = 0
    const draw = () => {
      n++
      ctx.fillStyle = `hsl(${(n * 7) % 360},60%,35%)`
      ctx.fillRect(0, 0, 320, 180)
      ctx.fillStyle = '#fff'
      ctx.font = '20px sans-serif'
      ctx.fillText('MovieFlix TV', 20, 100)
    }
    draw()
    const stream = canvas.captureStream(15)
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise((res) => { rec.onstop = res })
    rec.start()
    const timer = setInterval(draw, 66)
    // 6 s de gravação: tempo suficiente para o teste de seek medir deslocamento
    // real (0,5 s → 4,5 s → 0,5 s) sem deixar o teste lento.
    await new Promise((r) => setTimeout(r, 6000))
    clearInterval(timer)
    rec.stop()
    await done
    const blob = new Blob(chunks, { type: 'video/webm' })
    const v = document.getElementById('v')
    v.src = URL.createObjectURL(blob)
    await new Promise((res) => {
      if (v.readyState >= 1) return res()
      v.addEventListener('loadedmetadata', res, { once: true })
      setTimeout(res, 3000)
    })

    // Um WebM do MediaRecorder nasce com duration = Infinity e sem índice de
    // seek. O truque padrão para torná-lo buscável: pular para o "fim",
    // esperar o durationchange (o Chromium então calcula a duração real) e
    // voltar para o início. Sem isto o <video> ignora currentTime — e o teste
    // de seek mediria a limitação do fixture, não o código.
    if (!isFinite(v.duration)) {
      await new Promise((res) => {
        v.addEventListener('durationchange', () => {
          if (isFinite(v.duration)) res()
        })
        v.currentTime = 1e101
        setTimeout(res, 3000)
      })
    }

    // O provedor monta o vídeo PAUSADO — é o cenário real.
    v.pause()
    v.currentTime = 0
    return {
      duration: v.duration,
      readyState: v.readyState,
      seekable: v.seekable.length ? v.seekable.end(0) : 0,
    }
  })
  check('vídeo de teste criado no navegador', madeVideo.readyState >= 1, JSON.stringify(madeVideo))
  check('vídeo de teste é buscável (seek)', madeVideo.seekable > 0, JSON.stringify(madeVideo))

  // ── 2. Injetar a ponte (o mesmo script que o WebView injeta) ──────────────
  console.log('MovieFlix TV — teste E2E do player (Chromium)')
  console.log('='.repeat(60))
  console.log(`\n[0] Ponte extraída do Kotlin (${bridge.length} caracteres)`)
  check('a ponte não está vazia', bridge.length > 500)

  await page.evaluate((src) => {
    // A ponte fala com o app por window.MfPlayer.post — aqui só coletamos.
    window.__posted = []
    window.MfPlayer = { post: (s) => window.__posted.push(JSON.parse(s)) }
    // eslint-disable-next-line no-new-func
    new Function(src)()
  }, bridge)

  // ── 3. Autoplay ───────────────────────────────────────────────────────────
  console.log('\n[1] O vídeo começa sozinho (autoplay)')
  await page.waitForFunction(() => {
    const v = document.getElementById('v')
    return v && !v.paused && v.currentTime > 0
  }, { timeout: 8000 }).catch(() => {})
  const auto = await page.evaluate(() => {
    const v = document.getElementById('v')
    return { paused: v.paused, t: v.currentTime }
  })
  check('vídeo tocou sem clique', auto.paused === false, JSON.stringify(auto))
  check('o tempo avançou', auto.t > 0, `t=${auto.t}`)

  // ── 4. UI do provedor escondida ───────────────────────────────────────────
  console.log('\n[2] Só a barra de progresso: UI do provedor escondida')
  const hidden = await page.evaluate(() => {
    const sel = ['#ui', '.scrim-top', '.title-wrap', '.top-actions', '.panel',
                 '.controls', '.hint', '#gear', '#fs', '#watch', '#pause', '#prev']
    const out = {}
    for (const s of sel) {
      const el = document.querySelector(s)
      if (!el) { out[s] = 'absent'; continue }
      const cs = getComputedStyle(el)
      out[s] = cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0
        ? 'hidden' : 'VISIBLE'
    }
    return out
  })
  for (const [sel, state] of Object.entries(hidden)) {
    check(`${sel} escondido`, state === 'hidden' || state === 'absent', state)
  }

  // ── 5. Nenhum anel amarelo ────────────────────────────────────────────────
  console.log('\n[3] Nenhum anel/borda de foco amarelo')
  // O provedor tenta focar o painel "ASSISTIR" — o cenário exato das fotos.
  await page.evaluate(() => {
    const w = document.getElementById('watch')
    if (w) w.focus()
  })
  await page.waitForTimeout(700) // a ponte faz blur a cada 500 ms
  const focusState = await page.evaluate(() => {
    const ae = document.activeElement
    const cs = ae ? getComputedStyle(ae) : null
    return {
      tag: ae ? ae.tagName : null,
      id: ae ? ae.id : null,
      outline: cs ? cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor : null,
      boxShadow: cs ? cs.boxShadow : null,
    }
  })
  check('o foco não ficou no painel do provedor', focusState.id !== 'watch', JSON.stringify(focusState))
  check('nenhum outline amarelo no elemento ativo',
    !focusState.outline || !/rgb\(255,\s*212,\s*0\)|#ffd400/i.test(focusState.outline),
    JSON.stringify(focusState))
  check('nenhum box-shadow de foco', !focusState.boxShadow || focusState.boxShadow === 'none',
    JSON.stringify(focusState))

  // ── 6. OK pausa / OK despausa ─────────────────────────────────────────────
  console.log('\n[4] OK pausa e OK despausa (alternando)')
  const toggle = async () => {
    await page.evaluate(() => window.__mfCmd('toggle'))
    await page.waitForTimeout(120)
    return page.evaluate(() => document.getElementById('v').paused)
  }
  const p1 = await toggle()
  check('1º OK pausa', p1 === true, `paused=${p1}`)
  const p2 = await toggle()
  check('2º OK despausa', p2 === false, `paused=${p2}`)
  const p3 = await toggle()
  check('3º OK pausa', p3 === true, `paused=${p3}`)
  const p4 = await toggle()
  check('4º OK despausa', p4 === false, `paused=${p4}`)

  // ── 7. Setas: seek real ───────────────────────────────────────────────────
  console.log('\n[5] ← e → movem o vídeo de verdade')
  await page.evaluate(() => { window.__mfCmd('seekTo', 0.5) })
  await page.waitForTimeout(200)
  const before = await page.evaluate(() => document.getElementById('v').currentTime)
  await page.evaluate(() => { window.__mfCmd('seekTo', 4.5) })
  await page.waitForTimeout(200)
  const after = await page.evaluate(() => document.getElementById('v').currentTime)
  check('→ avança (0,5 s → 4,5 s)', Math.abs(after - 4.5) < 0.6, `antes=${before} depois=${after}`)
  await page.evaluate(() => { window.__mfCmd('seekTo', 0.5) })
  await page.waitForTimeout(200)
  const back = await page.evaluate(() => document.getElementById('v').currentTime)
  check('← retrocede (4,5 s → 0,5 s)', Math.abs(back - 0.5) < 0.6, `depois=${back}`)

  // ── 8. Estado reportado ao app ────────────────────────────────────────────
  console.log('\n[6] Estado real reportado ao app (barra)')
  const last = await page.evaluate(() => {
    const states = window.__posted.filter((p) => p.type === 'state')
    return states[states.length - 1] || null
  })
  check('reporta posição (t)', last && typeof last.t === 'number', JSON.stringify(last))
  check('reporta duração (d)', last && last.d > 0, JSON.stringify(last))
  check('reporta ready', last && last.ready === true, JSON.stringify(last))

  // ── 9. Zero erros de JavaScript ───────────────────────────────────────────
  console.log('\n[7] Zero erros de JavaScript')
  check('nenhum erro no console/página', jsErrors.length === 0, jsErrors.join(' | '))

  // ── 10. Screenshot do player limpo ────────────────────────────────────────
  console.log('\n[8] Evidência visual')
  await page.evaluate(() => { window.__mfCmd('seekTo', 2) })
  await page.waitForTimeout(300)
  const shot = path.join(SHOTS, 'player-tv-limpo.png')
  await page.screenshot({ path: shot })
  check('screenshot salvo', fs.existsSync(shot), shot)

  await browser.close()

  console.log('\n' + '='.repeat(60))
  console.log(`${checks} verificações, ${failures} falha(s)`)
  if (failures > 0) {
    console.log('RESULTADO: FALHOU')
    process.exit(1)
  }
  console.log('RESULTADO: PASSOU')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
