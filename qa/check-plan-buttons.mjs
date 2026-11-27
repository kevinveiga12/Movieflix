/**
 * Verificação do CTA da página de planos.
 *
 * Mede, no navegador real, se o texto de cada botão "Pagar com Pix ou cartão de
 * crédito" cabe dentro do retângulo vermelho. Não confia em CSS lido: compara
 * a caixa do TEXTO com a caixa do BOTÃO, em três larguras de tela.
 *
 * Uso: node qa/check-plan-buttons.mjs
 */
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve('dist')
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp',
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(ROOT, url)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, 'index.html') // SPA fallback
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

await new Promise((r) => server.listen(4173, r))

// O sandbox já tem um Chromium do Playwright; aponta para ele em vez de baixar.
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1181/chrome-linux/headless_shell',
})
const results = []
let failures = 0

for (const width of [360, 414, 768, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })

  /*
    A página de planos lê preços e configuração de pagamento do servidor. Sem
    backend no teste, as rotas são respondidas aqui — com o Pix LIGADO, que é o
    estado em que o botão "Pagar com Pix ou cartão de crédito" aparece.
  */
  await page.route('**/api/plans*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        whatsapp: { number: '5511999999999', display: '(11) 99999-9999' },
        plans: [
          {
            code: 'basico', name: 'Básico', tagline: 'Para começar',
            features: ['Catálogo completo', 'Full HD', '1 tela'],
            periods: [
              { code: '1m', label: '1 mês', price_cents: 1990, price_label: 'R$ 19,90', full_label: 'R$ 19,90', saved_label: null },
              { code: '3m', label: '3 meses', price_cents: 4776, price_label: 'R$ 47,76', full_label: 'R$ 59,70', saved_label: 'R$ 11,94' },
              { code: '12m', label: '1 ano', price_cents: 11940, price_label: 'R$ 119,40', full_label: 'R$ 238,80', saved_label: 'R$ 119,40' },
            ],
          },
          {
            code: 'premium', name: 'Premium', tagline: 'O mais completo',
            features: ['Catálogo completo', '4K', '4 telas', 'Downloads'],
            periods: [
              { code: '1m', label: '1 mês', price_cents: 2990, price_label: 'R$ 29,90', full_label: 'R$ 29,90', saved_label: null },
              { code: '3m', label: '3 meses', price_cents: 7176, price_label: 'R$ 71,76', full_label: 'R$ 89,70', saved_label: 'R$ 17,94' },
              { code: '12m', label: '1 ano', price_cents: 17940, price_label: 'R$ 179,40', full_label: 'R$ 358,80', saved_label: 'R$ 179,40' },
            ],
          },
          {
            code: 'familia', name: 'Família', tagline: 'Para a casa toda',
            features: ['Catálogo completo', '4K', '6 telas', 'Downloads'],
            periods: [
              { code: '1m', label: '1 mês', price_cents: 3990, price_label: 'R$ 39,90', full_label: 'R$ 39,90', saved_label: null },
              { code: '3m', label: '3 meses', price_cents: 9576, price_label: 'R$ 95,76', full_label: 'R$ 119,70', saved_label: 'R$ 23,94' },
              { code: '12m', label: '1 ano', price_cents: 23940, price_label: 'R$ 239,40', full_label: 'R$ 478,80', saved_label: 'R$ 239,40' },
            ],
          },
        ],
      }),
    }),
  )
  await page.route('**/api/payments/config*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pix_enabled: true, card_enabled: true, mode: 'live', public_key: 'pk_test' }),
    }),
  )
  await page.route('**/api/subscription*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subscription: null, active: false }) }),
  )

  await page.goto('http://127.0.0.1:4173/planos', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  const buttons = await page.$$eval('button.btn--plan, a.btn--plan', (els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      // Caixa real ocupada pelo texto: usa um Range sobre o conteúdo.
      const range = document.createRange()
      range.selectNodeContents(el)
      const t = range.getBoundingClientRect()
      return {
        label: (el.textContent || '').trim(),
        btn: { w: b.width, h: b.height, top: b.top, bottom: b.bottom, left: b.left, right: b.right },
        text: { w: t.width, h: t.height, top: t.top, bottom: t.bottom, left: t.left, right: t.right },
        overflowX: cs.overflowX,
        whiteSpace: cs.whiteSpace,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
      }
    }),
  )

  if (buttons.length === 0) {
    results.push({ width, ok: false, note: 'nenhum botão .btn--plan encontrado' })
    failures++
    await page.close()
    continue
  }

  for (const b of buttons) {
    const eps = 0.6
    const textInside =
      b.text.left >= b.btn.left - eps &&
      b.text.right <= b.btn.right + eps &&
      b.text.top >= b.btn.top - eps &&
      b.text.bottom <= b.btn.bottom + eps
    const noScroll = b.scrollW <= b.clientW + 1 && b.scrollH <= b.clientH + 1
    const ok = textInside && noScroll
    if (!ok) failures++
    results.push({
      width,
      ok,
      label: b.label,
      btnW: +b.btn.w.toFixed(1),
      btnH: +b.btn.h.toFixed(1),
      textW: +b.text.w.toFixed(1),
      textH: +b.text.h.toFixed(1),
      textInside,
      noScroll,
      whiteSpace: b.whiteSpace,
      fontSize: b.fontSize,
      lineHeight: b.lineHeight,
    })
  }
  await page.close()
}

await browser.close()
server.close()

console.log(JSON.stringify(results, null, 2))
console.log(failures === 0 ? '\nRESULTADO: PASSOU' : `\nRESULTADO: FALHOU (${failures})`)
process.exit(failures === 0 ? 0 : 1)
