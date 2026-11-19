#!/usr/bin/env node
/**
 * Testes da PONTE JS do player da TV (modo embed).
 *
 *   node scripts/test-tv-bridge.mjs
 *
 * ── O que isto prova ────────────────────────────────────────────────────────
 *
 * O player do provedor roda em iframe de outro domínio. Quem controla o
 * `<video>` de verdade é o script injetado em `TvPlayerScreen.kt` (BRIDGE_JS),
 * via `WebViewCompat.addDocumentStartJavaScript`. Se esse script tiver um erro
 * de sintaxe, o WebView simplesmente não executa nada e o controle remoto
 * "não funciona" — sem nenhum erro visível no app.
 *
 * Aqui o script é EXTRAÍDO do arquivo Kotlin (não é uma cópia: se alguém editar
 * a ponte e quebrar, este teste falha), validado com `new Function` e executado
 * contra um DOM falso que imita um `<video>` de provedor:
 *
 *   - o vídeo nasce PAUSADO (como o provedor monta);
 *   - `play()`/`pause()` mudam `paused` e disparam eventos;
 *   - `currentTime` é gravável e limitado pela duração.
 *
 * Depois disso, os comandos que o app manda são exercitados:
 *   toggle (1º despausa, 2º pausa, 3º despausa), seekTo absoluto, vol, e o
 *   estado reportado de volta ao app.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(
  __dirname,
  '..',
  'tv/android/app/src/main/java/run/velixir/movieflix/tv/ui/screens/TvPlayerScreen.kt',
)

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

// ── 1. Extrair o BRIDGE_JS do Kotlin ────────────────────────────────────────
const kt = fs.readFileSync(SRC, 'utf8')
const m = kt.match(/private val BRIDGE_JS: String = """([\s\S]*?)"""\.trimIndent\(\)/)
if (!m) {
  console.error('ERRO: não achei BRIDGE_JS em TvPlayerScreen.kt')
  process.exit(1)
}
const bridge = m[1]

console.log('MovieFlix TV — testes da ponte JS do player (modo embed)')
console.log('='.repeat(60))
console.log(`\n[0] Ponte extraída do Kotlin (${bridge.length} caracteres)`)
check('a ponte não está vazia', bridge.length > 500)
check('expõe window.__mfCmd', bridge.includes('window.__mfCmd'))
check('tem comando seekTo (posição absoluta)', bridge.includes("cmd === 'seekTo'"))
check('tem comando toggle', bridge.includes("cmd === 'toggle'"))
check('NÃO tem comando vol (volume removido a pedido)', !bridge.includes("cmd === 'vol'"))
check('tenta autoplay ao anexar', bridge.includes('autoPlay()'))
check('esconde a UI do provedor', bridge.includes('hideProviderUi'))
check('mata o anel de foco (outline:none)', bridge.includes('outline:none'))
check('NÃO chama blur() no laço (briga de foco)', !bridge.includes('ae.blur()'))
check('esconde os controles REAIS do ArtPlayer', bridge.includes('.art-controls'))
check('esconde a barra inferior do ArtPlayer', bridge.includes('.art-bottom'))
check('esconde o botão de play inicial', bridge.includes('#wp-initial-play'))
check('nunca esconde o <video>', bridge.includes('video{display:block'))
check('desliga controls nativos do <video>', bridge.includes("v.controls = false"))
check('reaplica controls=false no laço', bridge.includes('vs[i].controls = false'))
check('repassa comando para iframes filhos', bridge.includes('__mfCmd: cmd'))
check('sobe estado por postMessage', bridge.includes('__mfState'))
check('só o frame do topo fala com o app', bridge.includes('S.isTop'))

// ── 2. Sintaxe ──────────────────────────────────────────────────────────────
console.log('\n[1] Sintaxe do JavaScript')
let factory
try {
  // new Function compila o corpo: erro de sintaxe estoura aqui.
  factory = new Function(bridge)
  check('compila sem erro de sintaxe', true)
} catch (e) {
  check('compila sem erro de sintaxe', false, e.message)
  console.log('\nRESULTADO: FALHOU')
  process.exit(1)
}

// ── 3. DOM falso ────────────────────────────────────────────────────────────
function makeVideo({ duration = 600, paused = true, currentTime = 0 } = {}) {
  const listeners = {}
  const v = {
    _paused: paused,
    _t: currentTime,
    duration,
    volume: 1,
    muted: false,
    readyState: 4,
    src: 'https://provedor/video.mp4',
    currentSrc: 'https://provedor/video.mp4',
    ended: false,
    get paused() {
      return this._paused
    },
    get currentTime() {
      return this._t
    },
    set currentTime(x) {
      this._t = Math.max(0, Math.min(this.duration, Number(x) || 0))
      this._fire('seeking')
      this._fire('seeked')
    },
    play() {
      this._paused = false
      this._fire('play')
      this._fire('playing')
      return Promise.resolve()
    },
    pause() {
      this._paused = true
      this._fire('pause')
    },
    addEventListener(ev, fn) {
      ;(listeners[ev] ||= []).push(fn)
    },
    _fire(ev) {
      for (const fn of listeners[ev] || []) fn()
    },
  }
  return v
}

function makeWindow(video) {
  const posted = []
  const clicks = []
  const fakeEl = {
    dispatchEvent: (ev) => {
      clicks.push(ev)
      return true
    },
  }
  const win = {
    MfPlayer: { post: (s) => posted.push(JSON.parse(s)) },
    document: {
      querySelectorAll: (sel) =>
        sel === 'video' && video ? [video] : [],
      elementFromPoint: () => fakeEl,
      body: fakeEl,
    },
    innerWidth: 1920,
    innerHeight: 1080,
    setInterval: () => 0, // não queremos timers reais no teste
    clearInterval: () => {},
    addEventListener: () => {},
    postMessage: () => {},
  }
  win.window = win
  // Frame principal: parent === window. É o único que fala com o app.
  win.parent = win
  return { win, posted, clicks }
}

function runBridge(video) {
  const { win, posted, clicks } = makeWindow(video)
  // A ponte usa `window`, `document` e `MouseEvent` globais.
  const MouseEventStub = function (type, opts) {
    this.type = type
    Object.assign(this, opts || {})
  }
  const fn = new Function(
    'window',
    'document',
    'setInterval',
    'clearInterval',
    'MouseEvent',
    bridge,
  )
  fn(win, win.document, win.setInterval, win.clearInterval, MouseEventStub)
  return { win, posted, clicks }
}

// ── 4. Estado inicial: vídeo pausado → ponte tenta tocar ────────────────────
console.log('\n[2] Estado inicial (provedor monta pausado)')
{
  const v = makeVideo({ paused: true })
  const { win, posted } = runBridge(v)
  check('a ponte se registrou em window.__mf', Boolean(win.__mf))
  check('autoplay tentou tocar o vídeo', v.paused === false, `paused=${v.paused}`)
  check('reportou estado ao app', posted.some((p) => p.type === 'state' || p.type === 'ready'))
}

// ── 5. OK alterna de verdade ────────────────────────────────────────────────
console.log('\n[3] OK alterna play/pause (1º despausa, 2º pausa, 3º despausa)')
{
  const v = makeVideo({ paused: true })
  const { win } = runBridge(v)
  // O autoplay já despausou; pausamos para começar do estado "entrou pausado".
  win.__mfCmd('pause')
  check('estado de partida: pausado', v.paused === true)

  win.__mfCmd('toggle')
  check('1º OK despausa', v.paused === false, `paused=${v.paused}`)
  win.__mfCmd('toggle')
  check('2º OK pausa', v.paused === true, `paused=${v.paused}`)
  win.__mfCmd('toggle')
  check('3º OK despausa', v.paused === false, `paused=${v.paused}`)
  win.__mfCmd('toggle')
  check('4º OK pausa', v.paused === true, `paused=${v.paused}`)
}

// ── 6. seekTo é absoluto e exato ────────────────────────────────────────────
console.log('\n[4] seekTo: posição absoluta, exata, dentro dos limites')
{
  const v = makeVideo({ paused: false, currentTime: 100 })
  const { win } = runBridge(v)

  win.__mfCmd('seekTo', 110)
  check('seekTo(110) → 110 s exatos', v.currentTime === 110, `t=${v.currentTime}`)

  win.__mfCmd('seekTo', 590)
  check('seekTo(590) → 590 s exatos', v.currentTime === 590, `t=${v.currentTime}`)

  win.__mfCmd('seekTo', -50)
  check('seekTo negativo → 0', v.currentTime === 0, `t=${v.currentTime}`)

  win.__mfCmd('seekTo', 99999)
  check('seekTo além da duração → duração', v.currentTime === 600, `t=${v.currentTime}`)

  // O ponto central do bug antigo: dois seeks seguidos não podem se perder.
  win.__mfCmd('seekTo', 200)
  win.__mfCmd('seekTo', 230)
  win.__mfCmd('seekTo', 290)
  check('seeks encadeados param no último alvo (290)', v.currentTime === 290, `t=${v.currentTime}`)
}

// ── 7. Volume ───────────────────────────────────────────────────────────────
console.log('\n[5] Volume removido do player (a pedido do proprietário)')
{
  const v = makeVideo({ paused: false })
  const { win } = runBridge(v)
  // O comando 'vol' não existe mais: a ponte não altera o volume do <video>.
  const before = v.volume
  win.__mfCmd('vol', 0.7)
  check('vol não altera o volume', v.volume === before, `vol=${v.volume}`)
  check('vol não desmuta', v.muted === false)
}

// ── 8. Estado reportado ao app ──────────────────────────────────────────────
console.log('\n[6] Estado reportado ao app (barrinha)')
{
  const v = makeVideo({ paused: false, currentTime: 42 })
  const { win, posted } = runBridge(v)
  win.__mfCmd('seekTo', 300)
  const last = posted.filter((p) => p.type === 'state').pop()
  check('reporta posição real (t)', last && Math.abs(last.t - 300) < 0.001, JSON.stringify(last))
  check('reporta duração (d)', last && last.d === 600, JSON.stringify(last))
  check('reporta playing', last && last.playing === true, JSON.stringify(last))
  check('NÃO reporta volume (removido)', last && last.vol === undefined, JSON.stringify(last))
  check('reporta ready (há vídeo)', last && last.ready === true, JSON.stringify(last))
}

// ── 9. Sem <video>: avisa em vez de fingir ──────────────────────────────────
console.log('\n[7] Provedor sem <video>')
{
  const { win, posted } = runBridge(null)
  const ok = win.__mfCmd('toggle')
  check('comando devolve false', ok === false)
  check('avisa o app com type=novideo', posted.some((p) => p.type === 'novideo'), JSON.stringify(posted))
}

// ── 10. Mouse virtual: clique na posição do cursor ───────────────────────────
console.log('\n[8] Mouse virtual: clickAt/clickAtY clicam no ponto do cursor')
{
  const v = makeVideo({ paused: false, currentTime: 10 })
  const { win, clicks } = runBridge(v)

  // O app manda X e Y em fração da tela; o clique só sai quando os dois chegam.
  win.__mfCmd('clickAt', 0.5)
  check('só X não clica ainda', clicks.length === 0, `clicks=${clicks.length}`)
  win.__mfCmd('clickAtY', 0.5)
  check('X+Y disparam o clique', clicks.length > 0, `clicks=${clicks.length}`)

  const click = clicks.find((c) => c.type === 'click')
  check('clique é do tipo click', Boolean(click))
  check('clique cai no centro (x=960)', click && click.clientX === 960, click && `x=${click.clientX}`)
  check('clique cai no centro (y=540)', click && click.clientY === 540, click && `y=${click.clientY}`)

  // Depois de clicar, o estado é limpo: um novo X sozinho não repete o clique.
  const before = clicks.length
  win.__mfCmd('clickAt', 0.2)
  check('estado limpo após o clique', clicks.length === before, `clicks=${clicks.length}`)
}

console.log('\n' + '='.repeat(60))
console.log(`${checks} verificações, ${failures} falha(s)`)
if (failures > 0) {
  console.log('RESULTADO: FALHOU')
  process.exit(1)
}
console.log('RESULTADO: PASSOU')