import { resolveDirectStream, resolveCleanEmbed } from '../server/lib/stream-resolver.js'
let fail=0
const ck=(n,ok,d='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!ok)fail++}

// 550: tem watchplay -> camada 1
const a = await resolveDirectStream({tmdbId:550})
ck('550 camada 1 (stream direto)', !!a, a?a.url.slice(0,55):'null')

// 1292035: só superflixapi -> camada 1 null, camada 2 null (captcha)
const b = await resolveDirectStream({tmdbId:1292035})
ck('1292035 camada 1 = null (só superflixapi)', b===null)
const b2 = await resolveCleanEmbed({tmdbId:1292035})
ck('1292035 camada 2 = null (superflixapi é captcha)', b2===null)

// 155: tem watchplay + embedplay
const c = await resolveDirectStream({tmdbId:155})
ck('155 camada 1', !!c, c?c.url.slice(0,55):'null')

// série
const d = await resolveDirectStream({tmdbId:1399,season:1,episode:1})
ck('1399 T1E1 camada 1', !!d, d?d.url.slice(0,55):'null')

// camada 2 num título sem watchplay mas com embedplay: procura um
for (const id of [27205, 13, 680, 238]) {
  const s = await resolveDirectStream({tmdbId:id})
  if (!s) { const e = await resolveCleanEmbed({tmdbId:id}); console.log(`  ${id}: camada1=null camada2=${e?e.url.slice(0,50):'null'}`) }
}
console.log(fail?`\n${fail} FALHA(S)`:'\nTODOS PASSARAM')
