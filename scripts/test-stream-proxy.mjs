import { resolveDirectStream } from '../server/lib/stream-resolver.js'
const BASE='http://localhost:3999'
let fail=0
const ck=(n,ok,d='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!ok)fail++}

const r = await resolveDirectStream({ tmdbId: 550 })
ck('resolve 550', !!r)
const proxied = `${BASE}/api/stream.m3u8?u=${encodeURIComponent(r.url)}&r=${encodeURIComponent(r.referer)}`

const pl = await fetch(proxied)
const text = await pl.text()
ck('playlist 200', pl.status===200, 'status '+pl.status)
ck('playlist content-type', /mpegurl/i.test(pl.headers.get('content-type')||''), pl.headers.get('content-type'))
ck('playlist tem #EXTM3U', text.startsWith('#EXTM3U'))
ck('playlist reescrita (URIs -> /api/stream)', text.includes('/api/stream/seg.mp4?u='))
ck('playlist sem URL crua do CDN', !/^https:\/\/vid/m.test(text))

// pega o primeiro segmento reescrito e busca
const seg = text.split('\n').map(l=>l.trim()).find(l=>l.startsWith('/api/stream/seg.mp4?u='))
ck('achou segmento reescrito', !!seg)
if (seg) {
  const s = await fetch(BASE+seg)
  const buf = await s.arrayBuffer()
  ck('segmento 200', s.status===200, 'status '+s.status)
  ck('segmento tem bytes', buf.byteLength>1000, buf.byteLength+' bytes')
  ck('segmento CORS *', s.headers.get('access-control-allow-origin')==='*')
  ck('segmento content-type video', /video|octet/i.test(s.headers.get('content-type')||''), s.headers.get('content-type'))
  // Range
  const s2 = await fetch(BASE+seg, { headers:{ Range:'bytes=0-1023' } })
  ck('range 206', s2.status===206, 'status '+s2.status)
  ck('range content-range', !!s2.headers.get('content-range'), s2.headers.get('content-range'))
}

// segurança
const bad1 = await fetch(`${BASE}/api/stream?u=${encodeURIComponent('http://169.254.169.254/latest/meta-data')}&r=${encodeURIComponent('https://v2.watchplay.shop/')}`)
ck('SSRF bloqueado (metadata)', bad1.status===403, 'status '+bad1.status)
const bad2 = await fetch(`${BASE}/api/stream?u=${encodeURIComponent(r.url)}&r=${encodeURIComponent('https://evil.test/')}`)
ck('referer inválido bloqueado', bad2.status===403, 'status '+bad2.status)
const bad3 = await fetch(`${BASE}/api/stream?u=${encodeURIComponent('https://evil.test/x.m3u8')}&r=${encodeURIComponent('https://v2.watchplay.shop/')}`)
ck('host não permitido bloqueado', bad3.status===403, 'status '+bad3.status)

console.log(fail?`\n${fail} FALHA(S)`:'\nTODOS PASSARAM')
process.exit(fail?1:0)
