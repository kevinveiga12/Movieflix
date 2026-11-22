/**
 * PROXY DO STREAM — `/api/stream?u=<url>&r=<referer>`
 *
 * Existe por dois motivos, e os dois são obrigatórios:
 *
 *   1. CORS. O CDN do provedor responde
 *      `Access-Control-Allow-Origin: https://v2.watchplay.shop` — o navegador
 *      do cliente não pode buscar o m3u8/segmentos direto. Servindo pelo nosso
 *      domínio, a origem passa a ser a nossa.
 *
 *   2. Referer. O CDN exige `Referer: https://v2.watchplay.shop/`; sem ele
 *      responde 403. O navegador não deixa a gente forjar Referer, o servidor
 *      deixa.
 *
 * Segurança: `u` só pode apontar para os hosts de vídeo do provedor
 * (`isAllowedStreamHost`) e `r` só pode ser um dos Referers do provedor
 * (`isAllowedReferer`). Sem isso a rota seria um proxy aberto (SSRF).
 *
 * Não guarda nada em disco: repassa o corpo byte a byte, com streaming, para
 * não carregar um segmento inteiro na memória do pod.
 */
import { Router } from 'express'
import { Readable } from 'node:stream'
import { isAllowedStreamHost, isAllowedReferer, rewritePlaylist } from '../lib/stream-resolver.js'

export const streamRouter = Router()

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Teto de tempo para abrir o stream no CDN (não para o corpo inteiro). */
const OPEN_TIMEOUT_MS = 15_000

streamRouter.get(['/stream', '/stream.m3u8', '/stream/:name'], async (req, res) => {
  const raw = typeof req.query.u === 'string' ? req.query.u : ''
  const referer = typeof req.query.r === 'string' ? req.query.r : ''

  if (!raw) return res.status(400).json({ error: 'missing_u' })
  if (!isAllowedStreamHost(raw)) return res.status(403).json({ error: 'host_not_allowed' })
  if (!isAllowedReferer(referer)) return res.status(403).json({ error: 'referer_not_allowed' })

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), OPEN_TIMEOUT_MS)

  try {
    const upstream = await fetch(raw, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Referer: referer,
        // O CDN serve segmentos por Range; repassamos o que o player pedir.
        ...(req.headers.range ? { Range: String(req.headers.range) } : {}),
        Accept: '*/*',
      },
    })

    clearTimeout(timer)

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status === 404 ? 404 : 502).json({ error: 'upstream', status: upstream.status })
    }

    const type = upstream.headers.get('content-type') ?? ''
    const isPlaylist = /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(raw)

    // Cabeçalhos que o player precisa para buscar/seek.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Accept-Ranges', 'bytes')
    const len = upstream.headers.get('content-length')
    if (len) res.setHeader('Content-Length', len)
    const range = upstream.headers.get('content-range')
    if (range) res.setHeader('Content-Range', range)

    if (isPlaylist) {
      // Playlist é texto e pequena: reescrevemos as URIs para passarem por aqui.
      const text = await upstream.text()
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      res.setHeader('Cache-Control', 'no-store')
      return res.status(upstream.status).send(rewritePlaylist(text, raw, referer))
    }

    // O CDN do provedor rotula os segmentos fMP4 como `text/javascript`
    // (os arquivos se chamam `0000.js`). O hls.js não se importa, mas um
    // content-type de script num <video> confunde o Safari e alguns WebViews.
    // Normalizamos para o tipo real do segmento.
    const segType = /javascript|text\/plain/i.test(type) || !type ? 'video/mp4' : type
    res.setHeader('Content-Type', segType)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.status(upstream.status)

    if (!upstream.body) return res.end()

    // Streaming: nada de bufferizar o segmento inteiro.
    const nodeStream = Readable.fromWeb(upstream.body)
    nodeStream.on('error', () => res.destroy())
    res.on('close', () => nodeStream.destroy())
    nodeStream.pipe(res)
  } catch (err) {
    clearTimeout(timer)
    if (res.headersSent) return res.destroy()
    const aborted = err?.name === 'AbortError'
    return res.status(aborted ? 504 : 502).json({ error: aborted ? 'timeout' : 'proxy_failed' })
  }
})
