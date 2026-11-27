import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const ROOT = path.resolve('dist')
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'}
const server=http.createServer((req,res)=>{const u=decodeURIComponent((req.url||'/').split('?')[0]);let f=path.join(ROOT,u);if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(ROOT,'index.html');res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res)})
await new Promise(r=>server.listen(4174,r))
const b=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1181/chrome-linux/headless_shell'})
const plans={whatsapp:{number:'5511999999999',display:'(11) 99999-9999'},plans:[
{code:'basico',name:'Básico',tagline:'Para começar',features:['Catálogo completo','Full HD','1 tela'],periods:[{code:'1m',label:'1 mês',price_cents:1990,price_label:'R$ 19,90',full_label:'R$ 19,90',saved_label:null},{code:'3m',label:'3 meses',price_cents:4776,price_label:'R$ 47,76',full_label:'R$ 59,70',saved_label:'R$ 11,94'},{code:'12m',label:'1 ano',price_cents:11940,price_label:'R$ 119,40',full_label:'R$ 238,80',saved_label:'R$ 119,40'}]},
{code:'premium',name:'Premium',tagline:'O mais completo',features:['Catálogo completo','4K','4 telas','Downloads'],periods:[{code:'1m',label:'1 mês',price_cents:2990,price_label:'R$ 29,90',full_label:'R$ 29,90',saved_label:null},{code:'3m',label:'3 meses',price_cents:7176,price_label:'R$ 71,76',full_label:'R$ 89,70',saved_label:'R$ 17,94'},{code:'12m',label:'1 ano',price_cents:17940,price_label:'R$ 179,40',full_label:'R$ 358,80',saved_label:'R$ 179,40'}]},
{code:'familia',name:'Família',tagline:'Para a casa toda',features:['Catálogo completo','4K','6 telas','Downloads'],periods:[{code:'1m',label:'1 mês',price_cents:3990,price_label:'R$ 39,90',full_label:'R$ 39,90',saved_label:null},{code:'3m',label:'3 meses',price_cents:9576,price_label:'R$ 95,76',full_label:'R$ 119,70',saved_label:'R$ 23,94'},{code:'12m',label:'1 ano',price_cents:23940,price_label:'R$ 239,40',full_label:'R$ 478,80',saved_label:'R$ 239,40'}]}]}
for (const [w,name] of [[360,'mobile'],[1280,'desktop']]) {
  const p=await b.newPage({viewport:{width:w,height:1000}})
  await p.route('**/api/plans*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(plans)}))
  await p.route('**/api/payments/config*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({pix_enabled:true,card_enabled:true,mode:'live',public_key:'pk'})}))
  await p.route('**/api/subscription*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({subscription:null,active:false})}))
  await p.goto('http://127.0.0.1:4174/planos',{waitUntil:'networkidle'}); await p.waitForTimeout(1500)
  const el=await p.$('.btn--plan'); if(el) await el.scrollIntoViewIfNeeded()
  await p.waitForTimeout(400)
  await p.screenshot({path:`qa/out/planos-${name}.png`,fullPage:false})
  await p.close()
}
await b.close(); server.close(); console.log('ok')
