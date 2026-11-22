import { resolveDirectStream, rewritePlaylist, isAllowedStreamHost, isAllowedReferer } from '../server/lib/stream-resolver.js'

let fail=0
const ck=(n,ok,d)=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!ok)fail++}

// segurança
ck('host permitido (hclod)', isAllowedStreamHost('https://vid7102402.hclod.qzz.io/st/x/playlist.m3u8'))
ck('host bloqueado (metadata)', !isAllowedStreamHost('http://169.254.169.254/latest/meta-data'))
ck('host bloqueado (http)', !isAllowedStreamHost('http://vid7102402.hclod.qzz.io/x.m3u8'))
ck('referer permitido', isAllowedReferer('https://v2.watchplay.shop/'))
ck('referer bloqueado', !isAllowedReferer('https://evil.test/'))

// rewrite
const pl = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:5.0,\n0000.js\n'
const out = rewritePlaylist(pl, 'https://vid7102402.hclod.qzz.io/st/_s3_/v01/550/playlist.m3u8?md5=a&expires=1', 'https://v2.watchplay.shop/')
ck('rewrite: MAP vira proxy', out.includes('URI="/api/stream/seg.mp4?u='))
ck('rewrite: segmento vira proxy', /^\/api\/stream\/(seg\.mp4|index\.m3u8)\?u=/m.test(out))
ck('rewrite: mantém #EXTM3U', out.startsWith('#EXTM3U'))
ck('rewrite: URI absoluta', out.includes(encodeURIComponent('https://vid7102402.hclod.qzz.io/st/_s3_/v01/550/init.mp4')))

// resolução real
const r = await resolveDirectStream({ tmdbId: 550 })
ck('resolve filme 550', !!r, r ? r.url.slice(0,70) : 'null')
if (r) ck('resolve: referer correto', r.referer === 'https://v2.watchplay.shop/')

const ep = await resolveDirectStream({ tmdbId: 1399, season: 1, episode: 1 })
ck('resolve série 1399 T1E1', !!ep, ep ? ep.url.slice(0,70) : 'null')

console.log(fail ? `\n${fail} FALHA(S)` : '\nTODOS PASSARAM')
process.exit(fail?1:0)
