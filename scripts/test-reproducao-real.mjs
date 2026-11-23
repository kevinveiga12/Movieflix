/**
 * TESTE DE REPRODUÇÃO REAL — o iframe do MegaEmbed NÃO é interceptado.
 *
 * Usa a mesma sessão falsa do test-player-megaembed (o site exige login para
 * montar o player), mas deixa o iframe do provedor carregar de verdade e
 * reporta o que aparece: vídeo tocando, "Sandbox Detectada", Cloudflare, ou
 * outra coisa. Não inventa resultado — imprime o texto que está na tela.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'https://movieflix.velixir.run'
const ALVO = process.env.ALVO ?? '/assistir/1292035?type=movie'
const EMBED = process.env.EMBED ?? 'https://mgeb.space/embed/1292035'

const FAKE_SUPABASE = 'https://fake-supabase.test'
const USER = {
  id: '00000000-0000-0000-0000-000000000001',
  aud: 'authenticated',
  email: 'teste@movieflix.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

const browser = await chromium.launch({
  headless: false,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  locale: 'pt-BR',
})
const page = await ctx.newPage()
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
})

const respostas = []
page.on('response', (r) => {
  const u = r.url()
  if (/mgeb|megaembed|cloudflare|challenges/.test(u)) respostas.push(`${r.status()} ${u.slice(0, 110)}`)
})

await page.route(`${FAKE_SUPABASE}/**`, async (route) => {
  const url = route.request().url()
  if (url.includes('/auth/v1/user')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) })
  }
  if (url.includes('/auth/v1/token')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'fake-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'fake-refresh',
        user: USER,
      }),
    })
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})

await page.route('**/api/config', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supabaseUrl: FAKE_SUPABASE, supabaseAnonKey: 'fake-anon', configured: true }),
  }),
)

await page.route('**/api/profile/ensure', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      profile: { id: USER.id, email: USER.email, name: 'Teste', is_admin: false, created_at: '2026-01-01T00:00:00Z' },
    }),
  }),
)

await page.route('**/api/playback/authorize', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      allowed: true,
      title: { tmdb_id: 1292035, title: 'GTA 6', quality: 'HD' },
      source: { url: EMBED, label: null, mode: 'embed' },
      plan: { code: null, label: 'Mês grátis', expires_at: null },
      access: null,
    }),
  }),
)

await page.route('**/api/subscription', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ subscription: null, active: true, access: null }),
  }),
)

// NENHUMA rota para mgeb.space: o iframe carrega de verdade.

await page.addInitScript(() => {
  const session = {
    access_token: 'fake-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'fake-refresh',
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      aud: 'authenticated',
      email: 'teste@movieflix.test',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  }
  localStorage.setItem('movieflix-auth', JSON.stringify(session))
})

await page.goto(`${BASE}${ALVO}`, { waitUntil: 'domcontentloaded' })

// Espera ATIVA pelo iframe.
await page
  .waitForFunction(() => Boolean(document.querySelector('.player-stage iframe')), { timeout: 30000 })
  .catch(() => console.log('AVISO: iframe nao montou em 30s'))

let tocando = false
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(3000)
  const snap = await page.evaluate(() => {
    const iframe = document.querySelector('.player-stage iframe')
    let inner = null
    try {
      const d = iframe?.contentDocument
      if (d) {
        const v = d.querySelector('video')
        inner = {
          text: (d.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 320),
          video: v
            ? { t: Number(v.currentTime.toFixed(2)), paused: v.paused, rs: v.readyState, src: (v.currentSrc || '').slice(0, 70) }
            : null,
        }
      }
    } catch {
      inner = { text: '<<cross-origin>>', video: null }
    }
    return { src: iframe?.getAttribute('src') ?? null, sandbox: iframe?.getAttribute('sandbox') ?? null, inner }
  })
  console.log(`\n[t=${(i + 1) * 3}s] src=${snap.src} sandbox=${snap.sandbox}`)
  console.log(`  texto: "${snap.inner?.text ?? ''}"`)
  console.log(`  video: ${snap.inner?.video ? JSON.stringify(snap.inner.video) : 'null'}`)
  if (snap.inner?.video && snap.inner.video.t > 1) {
    console.log('\n>>> VÍDEO TOCANDO (currentTime avançou)')
    tocando = true
    break
  }
}

console.log('\n--- respostas do provedor ---')
console.log([...new Set(respostas)].slice(0, 12).join('\n') || '(nenhuma)')
console.log(`\nRESULTADO: ${tocando ? 'VÍDEO TOCANDO' : 'NÃO CONFIRMADO — ver texto acima'}`)

await page.screenshot({ path: '/workspace/shots/reproducao-real.png' })
console.log('screenshot: /workspace/shots/reproducao-real.png')
await browser.close()
