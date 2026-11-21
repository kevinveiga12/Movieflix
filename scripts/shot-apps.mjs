import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3999'
const OUT = 'docs/apps-evidencias'

;(async () => {
  const browser = await chromium.launch()
  const errors = []

  // 1. Página pública de downloads — desktop
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text())
  })

  await page.goto(BASE + '/baixar-app', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/baixar-app-desktop.png`, fullPage: true })

  const bodyText = await page.innerText('body')
  const hasTv = /MovieFlix TV|Baixar para TV|Android TV/i.test(bodyText)
  const hasAndroid = /Baixar para Android/i.test(bodyText)
  const hasIos = /Instalar no iPhone/i.test(bodyText)
  console.log('TV mencionada na página pública:', hasTv)
  console.log('Android presente:', hasAndroid)
  console.log('iOS presente:', hasIos)

  // 2. Modo app (Android) — sem navbar/rodapé, com tab bar
  const appCtx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 MovieFlixApp/1.0',
    isMobile: true,
    hasTouch: true,
  })
  const appPage = await appCtx.newPage()
  appPage.on('pageerror', (e) => errors.push('app pageerror: ' + e.message))
  await appPage.goto(BASE + '/?app=android', { waitUntil: 'networkidle' })
  await appPage.waitForTimeout(1500)
  await appPage.screenshot({ path: `${OUT}/app-android-home.png` })

  const env = await appPage.getAttribute('html', 'data-mf-env')
  const navVisible = await appPage.isVisible('.nav')
  const footerVisible = await appPage.isVisible('.footer')
  const tabbarVisible = await appPage.isVisible('.mobile-nav')
  console.log('data-mf-env:', env)
  console.log('navbar de site visível:', navVisible)
  console.log('rodapé visível:', footerVisible)
  console.log('tab bar do app visível:', tabbarVisible)

  // 3. Modo site normal no celular (para comparar)
  const webCtx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  })
  const webPage = await webCtx.newPage()
  await webPage.goto(BASE + '/', { waitUntil: 'networkidle' })
  await webPage.waitForTimeout(1200)
  await webPage.screenshot({ path: `${OUT}/site-mobile-normal.png` })
  console.log('site normal: navbar visível:', await webPage.isVisible('.nav'))

  console.log('ERROS JS:', errors.length ? errors : 'nenhum')
  await browser.close()
})()
