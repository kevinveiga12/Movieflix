/* MovieFlix 2.0 — Service Worker
 *
 * Estratégia de cache SEGURA:
 *  - App shell (HTML/JS/CSS) → stale-while-revalidate, para abrir rápido.
 *  - Catálogo JSON → network-first com fallback em cache (dados podem mudar).
 *  - Imagens do TMDB → cache-first com limite de entradas.
 *  - /api/* → NUNCA cacheado (dados do usuário e respostas dinâmicas).
 *  - Requisições autenticadas / não-GET → passam direto, sem cache.
 *
 * Nada de conteúdo protegido ou dado privado é gravado em cache.
 */

const VERSION = 'movieflix-v2.0.1'
const SHELL = `${VERSION}-shell`
const IMAGES = `${VERSION}-images`
const CATALOG = `${VERSION}-catalog`

const SHELL_ASSETS = ['/', '/index.html', '/icon-192.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

async function trimCache(name, max) {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  if (keys.length <= max) return
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)))
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Nunca cachear API, auth ou qualquer coisa com credenciais.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/auth/')) return
  if (request.headers.get('authorization')) return

  // Imagens do TMDB
  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        try {
          const res = await fetch(request)
          if (res.ok) {
            await cache.put(request, res.clone())
            void trimCache(IMAGES, 220)
          }
          return res
        } catch {
          return new Response('', { status: 504 })
        }
      }),
    )
    return
  }

  // Catálogo JSON — network-first
  if (url.pathname.startsWith('/filmes/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CATALOG)
        try {
          const res = await fetch(request)
          // Só grava respostas reais e não vazias. Um catálogo vazio em cache
          // deixaria a home permanentemente em branco.
          if (res.ok) {
            const clone = res.clone()
            const body = await clone.text()
            if (body.length > 100) {
              await cache.put(request, new Response(body, { headers: res.headers }))
            }
            return new Response(body, { status: res.status, headers: res.headers })
          }
          return res
        } catch {
          const hit = await cache.match(request)
          if (hit) return hit
          return new Response('[]', { headers: { 'Content-Type': 'application/json' } })
        }
      })(),
    )
    return
  }

  // Navegação — network-first com fallback ao shell
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request)
          const cache = await caches.open(SHELL)
          await cache.put('/index.html', res.clone())
          return res
        } catch {
          const cache = await caches.open(SHELL)
          return (await cache.match('/index.html')) ?? (await cache.match('/')) ?? Response.error()
        }
      })(),
    )
    return
  }

  // Assets estáticos — stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit = await cache.match(request)
        const network = fetch(request)
          .then((res) => {
            if (res.ok) void cache.put(request, res.clone())
            return res
          })
          .catch(() => hit)
        return hit ?? network
      }),
    )
  }
})
