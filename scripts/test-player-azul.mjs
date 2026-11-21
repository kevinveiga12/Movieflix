/**
 * Teste real do player azul — com sessão simulada.
 *
 * O player só monta com sessão (regra do proprietário: sem login, vai para
 * /login). Para exercitar o player de verdade no navegador, este teste:
 *
 *   - intercepta /api/config e devolve um Supabase falso;
 *   - intercepta as chamadas do Supabase (auth/user, profiles) e devolve um
 *     usuário logado;
 *   - intercepta /api/playback/authorize e devolve uma fonte EMBED (o player
 *     azul), como o servidor faria;
 *   - intercepta o iframe do provedor com uma página que tem um <video> e um
 *     botão de tela cheia, para medir o comportamento do nosso lado.
 *
 * Depois mede, no DOM real:
 *   1. o player montou (iframe presente);
 *   2. NÃO existe overlay nosso por cima do iframe (era ele que engolia o
 *      clique do botão de tela cheia);
 *   3. o iframe permite tela cheia (allow=fullscreen + allowfullscreen);
 *   4. o clique no botão de tela cheia DENTRO do iframe chega ao elemento
 *      (não é interceptado por camada nossa) — medido por elementFromPoint;
 *   5. nenhuma URL do StreamBetter em nenhum recurso carregado.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8099'
let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const FAKE_SUPABASE = 'https://fake-supabase.test'
const EMBED_URL = 'https://myembed.biz/filme/1292035'

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await ctx.newPage()

const requestedHosts = new Set()
page.on('request', (r) => {
  try {
    requestedHosts.add(new URL(r.url()).host)
  } catch {}
})

const USER = {
  id: '00000000-0000-0000-0000-000000000001',
  aud: 'authenticated',
  email: 'teste@movieflix.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

// ── Supabase falso ────────────────────────────────────────────────────────
await page.route(`${FAKE_SUPABASE}/**`, async (route) => {
  const url = route.request().url()
  if (url.includes('/auth/v1/user')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(USER),
    })
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

// ── API do MovieFlix ──────────────────────────────────────────────────────
await page.route('**/api/config', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      supabaseUrl: FAKE_SUPABASE,
      supabaseAnonKey: 'fake-anon',
      configured: true,
    }),
  }),
)

await page.route('**/api/profile/ensure', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      profile: {
        id: USER.id,
        email: USER.email,
        name: 'Teste',
        is_admin: false,
        created_at: '2026-01-01T00:00:00Z',
      },
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
      source: { url: EMBED_URL, label: null, mode: 'embed' },
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

// ── iframe do provedor (player azul simulado) ─────────────────────────────
await page.route('**/myembed.biz/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><body style="margin:0;background:#000">
      <video id="v" width="100%" height="100%" autoplay muted playsinline></video>
      <button id="fs" style="position:absolute;top:8px;right:8px;z-index:5"
        onclick="document.getElementById('v').requestFullscreen()">Tela cheia</button>
    </body></html>`,
  }),
)

// Sessão já gravada no storage do Supabase (chave usada pelo app).
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

await page.goto(`${BASE}/assistir/1292035?type=movie`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)

const dom = await page.evaluate(() => {
  const stage = document.querySelector('.player-stage')
  const iframe = document.querySelector('.player-stage iframe')
  const overlay = document.querySelector('.player-overlay')
  const bar = document.querySelector('.player-overlay .player-bottom')
  const fsBtn = document.querySelector('.player-overlay .player-bottom .player-btn--main')
  const time = document.querySelector('.player-overlay .player-bottom .player-time')
  const rect = iframe?.getBoundingClientRect()
  const probe = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null
  return {
    path: location.pathname,
    hasStage: Boolean(stage),
    hasIframe: Boolean(iframe),
    hasOverlay: Boolean(overlay),
    hasBar: Boolean(bar),
    hasFsButton: Boolean(fsBtn),
    timeText: time?.textContent?.trim() ?? null,
    iframeAllow: iframe?.getAttribute('allow') ?? null,
    iframeAllowFullscreen: iframe?.hasAttribute('allowfullscreen') ?? false,
    iframeSrc: iframe?.getAttribute('src') ?? null,
    centerElement: probe ? `${probe.tagName}.${probe.className}` : null,
  }
})

console.log('DOM medido:', JSON.stringify(dom, null, 1))

check('player montou (iframe presente)', dom.hasIframe, dom.iframeSrc ?? 'sem iframe')
check('iframe e o player azul', /myembed\.biz/.test(dom.iframeSrc ?? ''), dom.iframeSrc ?? '')
check('existe UMA barra nossa no rodape', dom.hasBar, dom.hasBar ? 'presente' : 'ausente')
check('a barra tem o botao de tela cheia', dom.hasFsButton, dom.hasFsButton ? 'presente' : 'ausente')
check('a barra mostra o tempo', Boolean(dom.timeText), dom.timeText ?? 'vazio')
check(
  'o meio da tela continua sendo o iframe (video clicavel)',
  (dom.centerElement ?? '').startsWith('IFRAME'),
  `elemento no centro: ${dom.centerElement}`,
)
check(
  'iframe permite tela cheia',
  /fullscreen/.test(dom.iframeAllow ?? '') && dom.iframeAllowFullscreen,
  `allow="${dom.iframeAllow}" allowfullscreen=${dom.iframeAllowFullscreen}`,
)
check(
  'nenhum recurso do StreamBetter carregado',
  ![...requestedHosts].some((h) => /streambetter/i.test(h)),
  [...requestedHosts].filter((h) => /streambetter/i.test(h)).join(',') || 'nenhum',
)

// -- TELA CHEIA PELO NOSSO LADO -------------------------------------------
const before = await page.evaluate(() => ({
  fs: Boolean(document.fullscreenElement),
  overlay: getComputedStyle(document.querySelector('.player-overlay')).display,
}))

await page.click('.player-overlay .player-bottom .player-btn--main')
await page.waitForTimeout(900)

const during = await page.evaluate(() => {
  const ov = document.querySelector('.player-overlay')
  const stage = document.querySelector('.player-stage')
  const r = stage.getBoundingClientRect()
  return {
    fs: Boolean(document.fullscreenElement),
    overlayDisplay: ov ? getComputedStyle(ov).display : null,
    stageW: Math.round(r.width),
    stageH: Math.round(r.height),
    vw: window.innerWidth,
    vh: window.innerHeight,
  }
})

check(
  'tela cheia entrou (fullscreenElement definido)',
  during.fs === true,
  `antes=${before.fs} depois=${during.fs}`,
)
check(
  'em tela cheia a interface some (overlay display:none)',
  during.overlayDisplay === 'none',
  `display=${during.overlayDisplay}`,
)
check(
  'em tela cheia o video ocupa a tela inteira',
  during.stageW >= during.vw - 2 && during.stageH >= during.vh - 2,
  `stage=${during.stageW}x${during.stageH} viewport=${during.vw}x${during.vh}`,
)

// -- SAIR DA TELA CHEIA ----------------------------------------------------
await page.keyboard.press('Escape')
await page.waitForTimeout(900)

const after = await page.evaluate(() => {
  const ov = document.querySelector('.player-overlay')
  return {
    fs: Boolean(document.fullscreenElement),
    overlayDisplay: ov ? getComputedStyle(ov).display : null,
  }
})

check('saiu da tela cheia', after.fs === false, `fullscreenElement=${after.fs}`)
check(
  'a interface volta ao normal',
  after.overlayDisplay !== 'none',
  `display=${after.overlayDisplay}`,
)

await browser.close()
console.log(`\n${failures === 0 ? 'TODOS OS TESTES PASSARAM' : `${failures} FALHA(S)`}`)
process.exit(failures === 0 ? 0 : 1)
