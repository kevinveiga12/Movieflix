import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminRouter } from './routes/admin.js'
import { catalogRouter } from './routes/catalog.js'
import { tmdbRouter } from './routes/tmdb.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT ?? 3001)

app.set('trust proxy', 1)

app.use(
  helmet({
    contentSecurityPolicy: false, // o frontend usa imagens do TMDB e iframes do provedor
    crossOriginEmbedderPolicy: false,
  }),
)
app.use(compression())
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

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'movieflix',
    version: '2.0.0',
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  })
})

app.use('/api/catalog', catalogRouter)
app.use('/api/tmdb', tmdbRouter)
app.use('/api/admin', adminRouter)

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

app.listen(PORT, () => {
  console.log(`[MovieFlix] servidor em http://localhost:${PORT}`)
})
