import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import path from 'node:path'
import { getHeapStatistics } from 'node:v8'
import { fileURLToPath } from 'node:url'
import { adminRouter } from './routes/admin.js'
import { catalogRouter } from './routes/catalog.js'
import { tmdbRouter } from './routes/tmdb.js'
import { accessRouter } from './routes/access.js'
import { dbCatalogRouter } from './routes/db-catalog.js'
import { plansRouter } from './routes/plans.js'
import { catalogStats, orphanSeasons, hasDbCatalog } from './lib/db-catalog.js'
import { confirmAllPendingEmails } from './lib/profile.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
// A Velixir (e a maioria dos PaaS) injeta PORT e exige escuta em 0.0.0.0.
// O padrão 8080 é o que a Velixir usa quando PORT não está definida.
const PORT = Number(process.env.PORT ?? 8080)
const HOST = process.env.HOST ?? '0.0.0.0'

app.set('trust proxy', 1)

app.use(
  helmet({
    contentSecurityPolicy: false, // o frontend usa imagens do TMDB e iframes do provedor
    crossOriginEmbedderPolicy: false,
  }),
)
/**
 * Compressão — com uma exceção importante para a memória.
 *
 * `compression()` comprime cada resposta EM MEMÓRIA. O catálogo estático
 * (`/filmes/filmes.light.json` = 15 MB, `series.light.json` = 8 MB) é servido
 * por `express.static` e, sem filtro, cada download concorrente alocava um
 * buffer de gzip de vários MB. Numa home com vários visitantes simultâneos
 * isso somava dezenas de MB de pico e ajudava a estourar os 256 MB do plano.
 *
 * Esses arquivos já são servidos com `Cache-Control` e são baixados uma única
 * vez por sessão (o frontend guarda em cache), então o ganho de gzip não paga
 * o custo de memória. Deixamos o Express servi-los crus (sem recompressão por
 * requisição). Todo o resto continua comprimido normalmente.
 */
app.use(
  compression({
    filter(req, res) {
      if (req.path.startsWith('/filmes/')) return false
      return compression.filter(req, res)
    },
  }),
)
app.use(express.json({ limit: '2mb' }))

const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(
  cors({
    origin(origin, cb) {
      // Sem Origin = requisição server-to-server ou same-origin.
      if (!origin) return cb(null, true)
      if (allowedOrigins.length === 0) return cb(null, true)
      if (allowedOrigins.includes(origin)) return cb(null, true)
      return cb(new Error('Origem não permitida'))
    },
    credentials: true,
  }),
)

// Limite global generoso; limites mais rígidos nas rotas sensíveis.
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 240,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente novamente em instantes.' },
  }),
)

// Checagens de configuração expostas aqui para diagnosticar produção sem
// precisar de acesso ao painel. Mostra só SE a variável existe, nunca o valor.
app.get('/api/health', async (_req, res) => {
  const stats = hasDbCatalog ? await catalogStats() : null
  res.json({
    status: 'ok',
    service: 'movieflix',
    version: '2.0.0',
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    // Diagnóstico de memória — permite acompanhar o consumo em produção sem
    // acesso ao painel. `heapLimitMb` mostra o teto do V8 (--max-old-space-size).
    memory: (() => {
      const m = process.memoryUsage()
      const heap = getHeapStatistics()
      return {
        rssMb: Math.round(m.rss / 1048576),
        heapUsedMb: Math.round(m.heapUsed / 1048576),
        heapTotalMb: Math.round(m.heapTotal / 1048576),
        heapLimitMb: Math.round(heap.heap_size_limit / 1048576),
      }
    })(),
    config: {
      supabaseUrl: Boolean(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL),
      supabaseAnon: Boolean(process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY),
      serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      tmdb: Boolean(process.env.TMDB_API_KEY),
    },
    catalog: stats,
  })
})

/**
 * GET /api/config — configuração pública do frontend.
 *
 * Existe para o build NÃO depender de variáveis `VITE_*`. O Vite resolve
 * `import.meta.env.VITE_*` em tempo de build; se a hospedagem não tiver essas
 * variáveis no momento do `npm run build`, o bundle sai quebrado. Aqui o
 * servidor entrega os valores que ele já tem em runtime, então trocar a chave
 * no painel passa a valer sem rebuild.
 *
 * Só a URL e a chave ANON saem daqui — ambas públicas por design e protegidas
 * por RLS. A SERVICE ROLE KEY nunca é exposta.
 */
app.get('/api/config', (_req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? null
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? null

  res.set('Cache-Control', 'no-store')
  res.json({
    supabaseUrl,
    supabaseAnonKey,
    configured: Boolean(supabaseUrl && supabaseAnonKey),
    whatsapp: {
      number: process.env.WHATSAPP_NUMBER ?? '5511943750307',
      display: process.env.WHATSAPP_DISPLAY ?? '(11) 94375-0307',
    },
  })
})

app.get('/api/health/catalog', async (_req, res) => {
  const [stats, orphans] = await Promise.all([catalogStats(), orphanSeasons()])
  res.json({ catalog: stats, orphanSeasons: orphans })
})

app.use('/api/catalog', catalogRouter)
app.use('/api/tmdb', tmdbRouter)
app.use('/api/admin', adminRouter)
app.use('/api/db', dbCatalogRouter)
app.use('/api/plans', plansRouter)
// Autorização de reprodução e assinatura (rotas /playback/authorize e /subscription).
app.use('/api', accessRouter)

// Frontend estático (build do Vite)
const dist = path.join(__dirname, '..', 'dist')
// redirect:false evita que /filmes (rota SPA) colida com a pasta public/filmes
// e devolva 301 em vez do index.html.
app.use(express.static(dist, { maxAge: '1h', index: false, redirect: false }))

// SPA fallback — tudo que não é /api vai para o index.html
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'Frontend não compilado. Rode `npm run build`.' })
  })
})

// Tratamento centralizado de erros — nunca vaza stack em produção.
app.use((err, _req, res, _next) => {
  console.error('[MovieFlix] erro:', err?.message ?? err)
  const status = err?.status ?? 500
  res.status(status).json({
    error: status === 500 ? 'Erro interno do servidor.' : err.message,
  })
})

app.listen(PORT, HOST, () => {
  console.log(`[MovieFlix] servidor em http://${HOST}:${PORT}`)
  // Diagnóstico de configuração no boot — mostra só SE existe, nunca o valor.
  console.log(
    '[MovieFlix] config:',
    JSON.stringify({
      supabaseUrl: Boolean(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL),
      supabaseAnon: Boolean(process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY),
      serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      tmdb: Boolean(process.env.TMDB_API_KEY),
    }),
  )

  // ── Aprovação das contas antigas ──────────────────────────────────────────
  //
  // O projeto nasceu com "Confirm email" ligado e o SMTP padrão do Supabase não
  // entrega para destinatários arbitrários. Toda conta criada antes da correção
  // ficou presa em `email_not_confirmed` e não conseguia entrar.
  //
  // A política do MovieFlix 2.0 é não exigir confirmação de e-mail, então
  // liberamos as contas existentes uma vez, no boot. A operação é idempotente
  // (só toca em quem ainda está pendente) e preserva ID, senha, perfil,
  // favoritos e histórico — grava apenas `email_confirmed_at`.
  //
  // Roda em background para não atrasar o health check. Desligue com
  // AUTO_CONFIRM_EMAILS=false se algum dia quiser voltar a exigir confirmação.
  if (process.env.AUTO_CONFIRM_EMAILS !== 'false') {
    ;(async () => {
      try {
        const result = await confirmAllPendingEmails()
        if (result.error) {
          console.warn('[MovieFlix] aprovação de contas:', result.error)
          return
        }
        console.log(
          `[MovieFlix] contas verificadas: ${result.scanned} · confirmadas agora: ${result.confirmed} · falhas: ${result.failed}`,
        )
      } catch (e) {
        console.warn('[MovieFlix] aprovação de contas falhou:', e?.message ?? e)
      }
    })()
  }
})
