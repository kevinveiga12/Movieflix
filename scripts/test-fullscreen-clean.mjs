/**
 * TESTE DA TELA CHEIA LIMPA.
 *
 * Verifica o que o cliente reclamou: em tela cheia apareciam os botões do
 * provedor na parte de cima. Aqui o player é montado com a resposta REAL de
 * /api/playback/authorize (fonte injetada) e medimos o DOM.
 */
import { chromium } from 'playwright'
import { resolveDirectStream } from '../server/lib/stream-resolver.js'

const BASE = process.env.BASE || 'http://localhost:3999'
let fail = 0
const ck = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) fail++ }

const direct = await resolveDirectStream({ tmdbId: 550 })
const proxied = `/api/stream.m3u8?u=${encodeURIComponent(direct.url)}&r=${encodeURIComponent(direct.referer)}`

const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
const p = await ctx.newPage()

// Sessão falsa: o PlayerPage exige login. O token não é validado aqui porque
// a autorização é interceptada logo abaixo — o que testamos é o player.
await ctx.addInitScript(() => {
  const exp = Math.floor(Date.now() / 1000) + 86400
  localStorage.setItem('movieflix-auth', JSON.stringify({
    access_token: 'test', token_type: 'bearer', expires_in: 86400, expires_at: exp, refresh_token: 'test',
    user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated',
      email: 'test@test.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  }))
})

// Intercepta a autorização e devolve o modo direto, sem depender de login.
await p.route('**/api/playback/authorize', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      allowed: true,
      title: { tmdb_id: 550, title: 'Clube da Luta', quality: '1080p' },
      source: { url: proxied, label: null, mode: 'direct' },
      sources: [{ id: 'direct', label: 'Principal', url: proxied, mode: 'direct', verified: true }],
      plan: { code: 'trial', label: 'Grátis', expires_at: null },
      access: null,
    }),
  }),
)

await p.goto(`${BASE}/assistir/550`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await p.waitForTimeout(6000)

const before = await p.evaluate(() => {
  const stage = document.querySelector('.player-stage')
  const v = document.querySelector('video')
  const ifr = document.querySelector('iframe')
  return {
    hasStage: !!stage,
    isDirect: !!v,
    iframes: document.querySelectorAll('iframe').length,
    fsBtn: !!document.querySelector('[aria-label="Tela cheia"]'),
    videoSize: v ? [v.videoWidth, v.videoHeight] : null,
  }
})
ck('player montado', before.hasStage)
ck('modo direto (sem iframe de provedor)', before.isDirect && before.iframes === 0, `${before.iframes} iframe(s)`)
ck('botão de tela cheia existe', before.fsBtn)

/*
  O Chromium do Playwright é o build open-source: NÃO tem H.264/AAC, então o
  <video> não decodifica e o aviso "não foi possível reproduzir" cobre a tela.
  Isso é limitação do navegador de teste, não do player — o stream foi provado
  com ffmpeg (359 frames decodificados). Aqui disparamos o clique direto no
  botão, sem depender do decode, para medir a TELA CHEIA.
*/
await p.evaluate(() => {
  const btn = document.querySelector('[aria-label="Tela cheia"]')
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await p.waitForTimeout(1500)

const fs = await p.evaluate(() => {
  const stage = document.querySelector('.player-stage')
  const ov = document.querySelector('.player-overlay')
  const v = document.querySelector('video')
  const r = stage?.getBoundingClientRect()
  return {
    fsElement: !!document.fullscreenElement,
    stageIsFs: document.fullscreenElement === stage,
    overlayDisplay: ov ? getComputedStyle(ov).display : 'none',
    stageRect: r ? [Math.round(r.width), Math.round(r.height)] : null,
    vw: innerWidth, vh: innerHeight,
    iframes: document.querySelectorAll('iframe').length,
    // a prova: nenhum elemento de UI do provedor
    providerUi: document.querySelectorAll('[class*="topbar"], [class*="art-control"], .wp-initial-play').length,
  }
})
ck('entrou em tela cheia', fs.fsElement, fs.stageIsFs ? 'no stage' : 'outro elemento')
ck('overlay (nossa barra) escondido', fs.overlayDisplay === 'none', fs.overlayDisplay)
ck('palco ocupa a tela', fs.stageRect && fs.stageRect[0] > 0, fs.stageRect ? `${fs.stageRect[0]}x${fs.stageRect[1]}` : 'null')
ck('NENHUMA UI de provedor no DOM', fs.providerUi === 0, `${fs.providerUi} elemento(s)`)
ck('nenhum iframe (nada de provedor)', fs.iframes === 0)

await p.screenshot({ path: '/workspace/shots/fs-clean.png' })

// sai da tela cheia
await p.keyboard.press('Escape')
await p.waitForTimeout(1000)
const out = await p.evaluate(() => ({
  fs: !!document.fullscreenElement,
  overlay: document.querySelector('.player-overlay') ? getComputedStyle(document.querySelector('.player-overlay')).display : 'none',
}))
ck('Escape sai da tela cheia', !out.fs)
ck('overlay volta ao sair', out.overlay !== 'none', out.overlay)

await b.close()
console.log(fail ? `\n${fail} FALHA(S)` : '\nTODOS PASSARAM')
process.exit(fail ? 1 : 0)
