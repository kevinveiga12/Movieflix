// Verifica, num navegador real, que quem NÃO está logado vai DIRETO ao login
// ao tentar assistir — sem tela intermediária do player.
//
//   node scripts/test-login-redirect.mjs [baseURL]
//
// Sai com código 1 se algum caso falhar.
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
let pass = 0
let fail = 0
function check(name, ok, extra = '') {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`)
  }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

// 1. Abrir /assistir/550 sem sessão → deve cair em /login
console.log('\n[1] /assistir/550 sem sessão redireciona para /login')
await page.goto(`${BASE}/assistir/550?type=movie`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
check('URL final é /login', new URL(page.url()).pathname === '/login', page.url())
const hasLoginForm = await page.locator('input[type="email"], input[type="password"]').count()
check('formulário de login visível', hasLoginForm > 0, `inputs=${hasLoginForm}`)

// 2. Home: clicar em "Assistir agora" sem sessão → /login
console.log('\n[2] Botão "Assistir agora" da home leva ao /login')
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const watch = page.getByRole('link', { name: /assistir agora/i }).first()
const hasWatch = (await watch.count()) > 0
check('botão "Assistir agora" existe', hasWatch)
if (hasWatch) {
  await watch.click()
  await page.waitForTimeout(1200)
  check('clicar leva a /login', new URL(page.url()).pathname === '/login', page.url())
}

// 3. Nenhuma tela intermediária "Crie sua conta para assistir"
console.log('\n[3] Sem tela intermediária do PlaybackGate')
const gate = await page.getByText(/crie sua conta para assistir/i).count()
check('não mostra "Crie sua conta para assistir"', gate === 0)

// 4. Navegação do catálogo continua livre (sem sessão)
console.log('\n[4] Catálogo navegável sem sessão')
await page.goto(`${BASE}/filmes`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
check('/filmes abre sem exigir login', new URL(page.url()).pathname === '/filmes', page.url())

await browser.close()
console.log(`\n${'='.repeat(60)}`)
console.log(`${pass + fail} verificações, ${fail} falha(s)`)
console.log(fail === 0 ? 'RESULTADO: PASSOU' : 'RESULTADO: FALHOU')
process.exit(fail === 0 ? 0 : 1)
