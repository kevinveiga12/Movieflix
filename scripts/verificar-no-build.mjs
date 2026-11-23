#!/usr/bin/env node
/**
 * VERIFICAÇÃO DE REPRODUÇÃO DURANTE O BUILD — falha segura.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE RODA NO BUILD
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * O provedor está atrás do Cloudflare Turnstile. Do sandbox de desenvolvimento
 * ele responde 403 `cf-mitigated: challenge` em TODOS os domínios. O servidor de
 * build da Velixir fica em outro datacenter — se ele passar, a verificação roda
 * aqui e os títulos quebrados são removidos já no artefato publicado.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * REGRAS DE SEGURANÇA (as mais importantes deste arquivo)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 1. NUNCA quebra o build. Qualquer erro é engolido e o build continua — uma
 *    falha de rede não pode impedir o site de subir.
 * 2. NUNCA oculta por incerteza. Só entra na lista o que o provedor respondeu
 *    com sinal POSITIVO de "sem fonte". 403/timeout/página vazia fica de fora.
 * 3. NUNCA oculta o catálogo inteiro. Se a amostra inicial mostrar que o
 *    ambiente está bloqueado (nenhum título abriu), desiste e não grava nada.
 * 4. ORÇAMENTO DE TEMPO. Passado o limite, para e grava o que já verificou —
 *    melhor cobrir parte do catálogo do que estourar o tempo de build.
 *
 * O resultado vai para `public/filmes/quebrados.json`, que o servidor lê como
 * parte da lista de ocultos. É um artefato de build: sempre refeito.
 *
 *   SKIP_EMBED_VERIFY=1     desliga (para builds rápidos)
 *   VERIFY_BUDGET_MS=…      orçamento de tempo (padrão 480000 = 8 min)
 *   VERIFY_CONCURRENCY=…    paralelismo (padrão 32)
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public', 'filmes')
const OUT = path.join(PUBLIC, 'quebrados.json')

const BUDGET_MS = Number(process.env.VERIFY_BUDGET_MS ?? 480_000)
const CONCURRENCY = Number(process.env.VERIFY_CONCURRENCY ?? 32)
const EMBED_BASE = process.env.MEGAEMBED_BASE ?? 'https://mgeb.space'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Sinal positivo de que o provedor NÃO tem fonte. */
const BROKEN = [
  /Movie or Episode Not Found/i,
  /Nenhuma fonte cadastrada/i,
  /Todas as fontes falharam/i,
  /Nenhuma op[çc][ãa]o dispon[íi]vel/i,
]

/** Sinal de que o player foi montado. */
const PLAYER = [/id="ve-iframe"/i, /id="server-groups"/i, /Player\.play\(/i, /<video[\s>]/i]

/** Desafio do Cloudflare — não é prova de nada. */
const CHALLENGE = [
  /Just a moment/i,
  /Um momento/i,
  /cf-mitigated/i,
  /challenges\.cloudflare\.com/i,
  /Performing security verification/i,
  /Executando verifica/i,
]

async function probe(id) {
  try {
    const res = await fetch(`${EMBED_BASE}/embed/${id}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    const html = (await res.text()).slice(0, 400_000)
    if (CHALLENGE.some((re) => re.test(html))) return 'bloqueado'
    if (BROKEN.some((re) => re.test(html))) return 'quebrado'
    if (PLAYER.some((re) => re.test(html))) return 'ok'
    return 'incerto'
  } catch {
    return 'incerto'
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(path.join(PUBLIC, file), 'utf8'))
  } catch {
    return []
  }
}

async function main() {
  if (process.env.SKIP_EMBED_VERIFY === '1') {
    console.log('[verify] desligado (SKIP_EMBED_VERIFY=1) — lista de quebrados mantida')
    return
  }

  const started = Date.now()

  // 1) Teste de sanidade: se estes quatro não abrirem, o ambiente está barrado.
  //    550 e 278 são títulos de catálogo global que existem em qualquer lugar.
  const sanity = await Promise.all(['550', '278', '155', '13'].map((id) => probe(id)))
  const algumOk = sanity.includes('ok')
  if (!algumOk) {
    console.log(`[verify] provedor inacessível deste ambiente (${sanity.join(', ')}) — nada foi ocultado`)
    return
  }

  const [movies, series] = await Promise.all([readJson('filmes.light.json'), readJson('series.light.json')])
  const targets = []
  for (const t of movies) {
    const id = String(t.tmdb_id ?? t.id)
    if (/^\d+$/.test(id)) targets.push({ tmdb_id: id, type: 'movie', title: t.title ?? '' })
  }
  for (const t of series) {
    const id = String(t.tmdb_id ?? t.id)
    if (/^\d+$/.test(id)) targets.push({ tmdb_id: id, type: 'tv', title: t.title ?? '' })
  }

  console.log(`[verify] verificando ${targets.length} títulos em ${EMBED_BASE}…`)

  const quebrados = []
  let next = 0
  let done = 0
  let blockedCount = 0
  let timedOut = false

  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
    while (true) {
      if (Date.now() - started > BUDGET_MS) {
        timedOut = true
        return
      }
      const i = next++
      if (i >= targets.length) return
      const t = targets[i]
      const r = await probe(t.tmdb_id)
      done++
      if (r === 'quebrado') quebrados.push({ ...t, motivo: 'embed sem fonte' })
      if (r === 'bloqueado') blockedCount++
      if (done % 2000 === 0) {
        console.log(`[verify]   ${done}/${targets.length} — ${quebrados.length} quebrados`)
      }
    }
  })

  await Promise.all(workers)

  // 2) Se a maioria das respostas foi bloqueio, o resultado não é confiável.
  const bloqueado = blockedCount > 0 && blockedCount > done * 0.5
  if (bloqueado) {
    console.log(`[verify] ${blockedCount} de ${done} bloqueados — resultado descartado, nada foi ocultado`)
    return
  }

  const em = new Date().toISOString()
  await fs.writeFile(
    OUT,
    JSON.stringify(
      {
        _comentario:
          'Gerado no build por scripts/verificar-no-build.mjs. Títulos que o provedor respondeu como "sem fonte" (a tela de erro em vez do player). Só entra aqui sinal POSITIVO de quebra.',
        gerado_em: em,
        provedor: EMBED_BASE,
        verificado: done,
        total_catalogo: targets.length,
        total_quebrados: quebrados.length,
        incompleto: timedOut,
        itens: quebrados,
      },
      null,
      2,
    ),
    'utf8',
  )

  const secs = ((Date.now() - started) / 1000).toFixed(0)
  console.log(
    `[verify] ${quebrados.length} quebrados de ${done} verificados em ${secs}s${timedOut ? ' (orçamento de tempo atingido — verificação parcial)' : ''}`,
  )
}

main().catch((e) => {
  // Regra de segurança nº 1: nunca quebrar o build.
  console.log(`[verify] ignorado por erro: ${String(e?.message ?? e).slice(0, 120)}`)
})
