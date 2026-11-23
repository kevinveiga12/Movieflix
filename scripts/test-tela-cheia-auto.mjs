/**
 * ════════════════════════════════════════════════════════════════════════════
 * TESTE REAL — TELA CHEIA AUTOMÁTICA AO CLICAR EM "ASSISTIR"
 * ════════════════════════════════════════════════════════════════════════════
 *
 * O que este teste faz de verdade, num Chromium real:
 *
 *   1. Abre a página do TÍTULO (não o player) com sessão simulada.
 *   2. Clica no botão "Assistir" — um clique real, com gesto de usuário.
 *   3. Confirma que o documento ENTROU em tela cheia nesse clique.
 *   4. Confirma que o player montou JÁ em tela cheia (o estado sobreviveu à
 *      navegação do React Router, que não recarrega o documento).
 *   5. Confirma que o BOTÃO BRANCO de tela cheia NÃO existe mais.
 *   6. Confirma que a nossa barra some em tela cheia (só o vídeo).
 *   7. Sai da tela cheia e confirma que volta ao normal.
 *
 * ── O QUE ELE NÃO PROVA ────────────────────────────────────────────────────
 *
 * O iframe do provedor é simulado: o Cloudflare do MegaEmbed responde 403 a
 * este ambiente. O que se mede aqui é o NOSSO lado — o gesto, o estado, a
 * navegação, a ausência do botão e a saída. A reprodução do vídeo em si não é
 * medida por este teste.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8099'
let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const FAKE_SUPABASE = 'https://fake-supabase.test'
const EMBED_URL = 'https://mgeb.space/embed/1744462'
const TMDB = 1744462

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()

const USER = {
  id: '00000000-0000-0000-0000-000000000001',
  aud: 'authenticated',
  email: 'teste@movieflix.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

// ── Supabase falso ─────────────────────────────────────────────────────────
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

// ── API do MovieFlix ───────────────────────────────────────────────────────
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
      title: { tmdb_id: TMDB, title: 'GTA 6', quality: 'HD' },
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

// ── iframe do provedor (simulado) ──────────────────────────────────────────
await page.route('**/mgeb.space/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><body style="margin:0;background:#000">
      <video id="v" width="100%" height="100%" autoplay muted playsinline></video>
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

// ══════════════════════════════════════════════════════════════════════════
// 1. Página do TÍTULO — o clique em "Assistir"
// ══════════════════════════════════════════════════════════════════════════
await page.goto(`${BASE}/titulo/movie/${TMDB}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

const beforeClick = await page.evaluate(() => ({
  path: location.pathname,
  fullscreen: Boolean(document.fullscreenElement),
  hasWatchBtn: Boolean(
    [...document.querySelectorAll('a.btn')].find((a) => /assistir/i.test(a.textContent ?? '')),
  ),
}))
console.log('ANTES DO CLIQUE:', JSON.stringify(beforeClick))
check('página do título carregou', beforeClick.path.startsWith('/titulo/'), beforeClick.path)
check('botão "Assistir" existe', beforeClick.hasWatchBtn)
check('ainda NÃO está em tela cheia', beforeClick.fullscreen === false)

// Clique REAL no "Assistir" — é este gesto que autoriza a tela cheia.
const watchLink = page
  .locator('a.btn')
  .filter({ hasText: /assistir|continuar assistindo/i })
  .first()

let clicked = false
try {
  await watchLink.click({ timeout: 8000 })
  clicked = true
} catch (e) {
  console.log('INFO  clique no "Assistir" falhou:', String(e).slice(0, 160))
}
check('clique em "Assistir" executado', clicked)

// Espera ATIVA pelo player.
await page.waitForSelector('.player-stage', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(2000)

// ══════════════════════════════════════════════════════════════════════════
// 2. O player montou JÁ em tela cheia?
// ══════════════════════════════════════════════════════════════════════════
const afterClick = await page.evaluate(() => {
  const stage = document.querySelector('.player-stage')
  const iframe = document.querySelector('.player-stage iframe')
  const overlay = document.querySelector('.player-overlay')
  const whiteBtn = document.querySelector('.player-overlay .player-btn--main')
  const exitBtn = document.querySelector('.player-exit')
  const rect = stage?.getBoundingClientRect()
  const overlayStyle = overlay ? getComputedStyle(overlay) : null
  return {
    path: location.pathname,
    fullscreen: Boolean(document.fullscreenElement),
    fullscreenTag: document.fullscreenElement?.tagName ?? null,
    hasStage: Boolean(stage),
    hasIframe: Boolean(iframe),
    iframeSrc: iframe?.getAttribute('src') ?? null,
    iframeSandbox: iframe?.getAttribute('sandbox') ?? null,
    // O BOTÃO BRANCO: era `.player-btn--main` dentro da barra do embed.
    hasWhiteFullscreenBtn: Boolean(whiteBtn),
    hasExitBtn: Boolean(exitBtn),
    overlayDisplay: overlayStyle?.display ?? null,
    stageW: rect ? Math.round(rect.width) : null,
    stageH: rect ? Math.round(rect.height) : null,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
  }
})
console.log('DEPOIS DO CLIQUE:', JSON.stringify(afterClick, null, 1))

check('navegou para o player', afterClick.path.startsWith('/assistir/'), afterClick.path)
check('player montou', afterClick.hasStage && afterClick.hasIframe)
check('iframe é o MegaEmbed', (afterClick.iframeSrc ?? '').includes('mgeb.space'), afterClick.iframeSrc)
check('iframe SEM sandbox', afterClick.iframeSandbox === null, String(afterClick.iframeSandbox))

// ── O PONTO CENTRAL DO PEDIDO ─────────────────────────────────────────────
check(
  'ENTROU EM TELA CHEIA automaticamente no clique',
  afterClick.fullscreen === true,
  `fullscreenElement=${afterClick.fullscreenTag}`,
)
check(
  'BOTÃO BRANCO de tela cheia NÃO existe',
  afterClick.hasWhiteFullscreenBtn === false,
)
check(
  'nossa barra some em tela cheia (só o vídeo)',
  afterClick.overlayDisplay === 'none',
  `display=${afterClick.overlayDisplay}`,
)
check(
  'vídeo ocupa a tela inteira',
  afterClick.stageW === afterClick.viewportW && afterClick.stageH === afterClick.viewportH,
  `${afterClick.stageW}x${afterClick.stageH} vs ${afterClick.viewportW}x${afterClick.viewportH}`,
)

// ══════════════════════════════════════════════════════════════════════════
// 3. Sair da tela cheia volta ao normal
// ══════════════════════════════════════════════════════════════════════════
await page.keyboard.press('Escape')
await page.waitForTimeout(1200)

const afterExit = await page.evaluate(() => {
  const overlay = document.querySelector('.player-overlay')
  return {
    fullscreen: Boolean(document.fullscreenElement),
    overlayDisplay: overlay ? getComputedStyle(overlay).display : null,
    path: location.pathname,
  }
})
console.log('DEPOIS DE SAIR:', JSON.stringify(afterExit))

check('saiu da tela cheia', afterExit.fullscreen === false)
check('nossa barra volta ao normal', afterExit.overlayDisplay !== 'none', `display=${afterExit.overlayDisplay}`)
check('continua no player (não saiu da página)', afterExit.path.startsWith('/assistir/'), afterExit.path)

// ══════════════════════════════════════════════════════════════════════════
// 4. Episódio de série — mesmo caminho
// ══════════════════════════════════════════════════════════════════════════
const page2 = await ctx.newPage()
await page2.route(`${FAKE_SUPABASE}/**`, async (route) => {
  const url = route.request().url()
  if (url.includes('/auth/v1/user')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) })
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})
await page2.route('**/api/config', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supabaseUrl: FAKE_SUPABASE, supabaseAnonKey: 'fake-anon', configured: true }),
  }),
)
await page2.route('**/api/profile/ensure', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      profile: { id: USER.id, email: USER.email, name: 'Teste', is_admin: false, created_at: '2026-01-01T00:00:00Z' },
    }),
  }),
)
await page2.route('**/api/playback/authorize', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      allowed: true,
      title: { tmdb_id: 1399, title: 'Série Teste', quality: 'HD' },
      source: { url: 'https://mgeb.space/embed/1399/1/1', label: null, mode: 'embed' },
      plan: { code: null, label: 'Mês grátis', expires_at: null },
      access: null,
    }),
  }),
)
await page2.route('**/api/subscription', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ subscription: null, active: true, access: null }),
  }),
)
await page2.route('**/mgeb.space/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body style="margin:0;background:#000"><video autoplay muted playsinline></video></body></html>',
  }),
)
await page2.addInitScript(() => {
  localStorage.setItem(
    'movieflix-auth',
    JSON.stringify({
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
    }),
  )
})

await page2.goto(`${BASE}/assistir/1399?type=tv&season=1&episode=1`, { waitUntil: 'domcontentloaded' })
await page2.waitForSelector('.player-stage', { timeout: 20000 }).catch(() => {})
await page2.waitForTimeout(1500)

const ep = await page2.evaluate(() => {
  const iframe = document.querySelector('.player-stage iframe')
  const whiteBtn = document.querySelector('.player-overlay .player-btn--main')
  return {
    hasIframe: Boolean(iframe),
    iframeSrc: iframe?.getAttribute('src') ?? null,
    hasWhiteFullscreenBtn: Boolean(whiteBtn),
  }
})
console.log('EPISÓDIO:', JSON.stringify(ep))
check('episódio: player montou', ep.hasIframe)
check('episódio: URL de episódio do MegaEmbed', /mgeb\.space\/embed\/1399\/1\/1/.test(ep.iframeSrc ?? ''), ep.iframeSrc)
check('episódio: sem botão branco', ep.hasWhiteFullscreenBtn === false)

await browser.close()

console.log(`\n${failures === 0 ? 'TODOS OS TESTES PASSARAM' : `${failures} FALHA(S)`}`)
process.exit(failures === 0 ? 0 : 1)
