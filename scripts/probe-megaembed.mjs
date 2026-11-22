/**
 * Sonda do MegaEmbed — descobre, com navegador real, o que o embed entrega:
 *   - o embed aceita ser carregado dentro de um iframe de outra origem?
 *   - o <video> toca de verdade (readyState/currentTime)?
 *   - de onde vem o stream (m3u8/mp4)?
 *   - há anúncios / pop-ups / redirecionamentos?
 *   - o player expõe API (postMessage, window.*) para controlar de fora?
 *
 * Uso: node scripts/probe-megaembed.mjs [tmdbId]
 */
import { chromium } from 'playwright'

const TMDB = process.argv[2] || '550'
const EMBED = `https://mgeb.space/embed/${TMDB}`

const browser = await chromium.launch({
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'pt-BR',
})

const media = []
const popups = []
const consoleErrs = []

ctx.on('page', (p) => popups.push(p.url()))

const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160))
})
page.on('request', (r) => {
  const u = r.url()
  if (/\.m3u8|\.mp4|\.ts(\?|$)|\.vtt|\.srt/i.test(u)) media.push(u.slice(0, 200))
})

// ── 1. O embed direto ────────────────────────────────────────────────
console.log('=== 1. EMBED DIRETO ===')
await page.goto(EMBED, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(12000)

const direct = await page.evaluate(() => {
  const v = document.querySelector('video')
  return {
    title: document.title,
    hasVideo: !!v,
    readyState: v ? v.readyState : null,
    duration: v ? v.duration : null,
    paused: v ? v.paused : null,
    currentTime: v ? v.currentTime : null,
    src: v ? (v.src || '').slice(0, 80) : null,
    bodyText: document.body.innerText.slice(0, 200),
    // API exposta?
    globals: Object.keys(window).filter((k) =>
      /player|mega|video|hls/i.test(k)
    ).slice(0, 20),
  }
})
console.log(JSON.stringify(direct, null, 2))

// tenta dar play
const played = await page.evaluate(async () => {
  const v = document.querySelector('video')
  if (!v) return { ok: false, why: 'sem video' }
  try {
    await v.play()
  } catch (e) {
    return { ok: false, why: String(e).slice(0, 120) }
  }
  await new Promise((r) => setTimeout(r, 6000))
  return {
    ok: true,
    currentTime: v.currentTime,
    readyState: v.readyState,
    paused: v.paused,
    duration: v.duration,
  }
})
console.log('PLAY:', JSON.stringify(played))

// ── 2. O embed dentro de um iframe de outra origem ───────────────────
console.log('\n=== 2. EMBED EM IFRAME CROSS-ORIGIN ===')
const host = await ctx.newPage()
await host.setContent(
  `<html><body style="margin:0;background:#000">
   <iframe id="f" src="${EMBED}" style="width:100vw;height:100vh;border:0"
     allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>
   </body></html>`,
  { waitUntil: 'domcontentloaded' }
)
await host.waitForTimeout(15000)

const frames = host.frames().map((f) => f.url())
console.log('FRAMES:', JSON.stringify(frames, null, 2))

let inFrame = null
for (const f of host.frames()) {
  if (!f.url().includes('mgeb')) continue
  try {
    inFrame = await f.evaluate(() => {
      const v = document.querySelector('video')
      return {
        url: location.href,
        title: document.title,
        hasVideo: !!v,
        readyState: v ? v.readyState : null,
        bodyText: document.body.innerText.slice(0, 150),
      }
    })
  } catch (e) {
    inFrame = { error: String(e).slice(0, 120) }
  }
}
console.log('DENTRO DO IFRAME:', JSON.stringify(inFrame, null, 2))

// ── 3. Anúncios ──────────────────────────────────────────────────────
console.log('\n=== 3. ANÚNCIOS / POPUPS ===')
console.log('popups:', JSON.stringify(popups))
const adFrames = host
  .frames()
  .map((f) => f.url())
  .filter((u) => /doubleclick|googlesyndication|adsystem|popads|propeller|onclickads|adsterra/i.test(u))
console.log('frames de anúncio:', JSON.stringify(adFrames))

console.log('\n=== 4. MÍDIA OBSERVADA ===')
console.log(JSON.stringify([...new Set(media)].slice(0, 12), null, 2))

console.log('\n=== 5. ERROS DE CONSOLE ===')
console.log(JSON.stringify([...new Set(consoleErrs)].slice(0, 8), null, 2))

await browser.close()
