/**
 * VERIFICAÇÃO DE REPRODUÇÃO — roda NO SERVIDOR, não no build.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE AQUI E NÃO NO SCRIPT DE BUILD
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * O provedor (mgeb.space) está atrás do Cloudflare Turnstile. Do ambiente de
 * build do sandbox ele responde 403 `cf-mitigated: challenge` em TODOS os
 * domínios — medido com curl e com Chromium real. Por isso a rodada anterior
 * (v163) só conseguiu cruzar a LISTA de IDs do provedor, e não a reprodução.
 *
 * O servidor de produção roda em outro datacenter. Se ele também for barrado,
 * esta verificação devolve tudo como "incerto" e NÃO oculta nada — nunca
 * esconde um título por causa de uma falha de rede.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O QUE CONTA COMO "QUEBRADO"
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Só um sinal positivo de que o player NÃO foi montado:
 *
 *   • a página traz "Movie or Episode Not Found" / "Nenhuma fonte cadastrada"
 *   • ou a página é a de erro do player ("Todas as fontes falharam")
 *
 * Qualquer outra coisa — 403, timeout, página sem marcador — é "incerto" e fica
 * de fora. Ocultar por engano é pior do que deixar um título quebrado, porque o
 * painel resolve o quebrado em um clique.
 */

/** Domínio do embed. O mesmo que o player usa no iframe. */
const EMBED_BASE = process.env.MEGAEMBED_BASE ?? 'https://mgeb.space'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Sinais de que o provedor NÃO tem fonte para o título. */
const BROKEN_MARKERS = [
  /Movie or Episode Not Found/i,
  /Nenhuma fonte cadastrada/i,
  /Todas as fontes falharam/i,
  /Nenhuma op[çc][ãa]o dispon[íi]vel/i,
]

/** Sinais de que o player foi montado (fonte existe). */
const PLAYER_MARKERS = [
  /id="ve-iframe"/i,
  /id="server-groups"/i,
  /Player\.play\(/i,
  /megatube-video/i,
  /<video[\s>]/i,
]

/** Sinais de desafio do Cloudflare — não é prova de nada. */
const CHALLENGE_MARKERS = [
  /Just a moment/i,
  /Um momento/i,
  /cf-mitigated/i,
  /challenges\.cloudflare\.com/i,
  /Performing security verification/i,
  /Executando verifica/i,
]

/**
 * Sonda um título.
 *
 * @returns {{ status: 'ok'|'quebrado'|'incerto', http: number, motivo?: string }}
 */
export async function probeTitle(tmdbId, { timeoutMs = 12_000 } = {}) {
  const id = String(tmdbId ?? '').trim()
  if (!/^\d+$/.test(id)) return { status: 'incerto', http: 0, motivo: 'id inválido' }

  const url = `${EMBED_BASE}/embed/${id}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const html = (await res.text()).slice(0, 400_000)

    if (CHALLENGE_MARKERS.some((re) => re.test(html))) {
      return { status: 'incerto', http: res.status, motivo: 'desafio do Cloudflare' }
    }
    if (BROKEN_MARKERS.some((re) => re.test(html))) {
      return { status: 'quebrado', http: res.status, motivo: 'provedor sem fonte' }
    }
    if (PLAYER_MARKERS.some((re) => re.test(html))) {
      return { status: 'ok', http: res.status }
    }
    return { status: 'incerto', http: res.status, motivo: 'página sem marcador' }
  } catch (err) {
    return { status: 'incerto', http: 0, motivo: String(err?.message ?? err).slice(0, 80) }
  }
}

/**
 * Verifica uma lista de títulos com concorrência limitada.
 *
 * `onProgress` é chamado a cada item concluído — o painel usa isso para mostrar
 * o andamento sem precisar de WebSocket.
 */
export async function verifyTitles(items, { concurrency = 8, onProgress } = {}) {
  const results = new Array(items.length)
  let next = 0
  let done = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      const item = items[i]
      const probe = await probeTitle(item.tmdb_id)
      results[i] = { ...item, ...probe }
      done++
      onProgress?.(done, items.length)
    }
  })

  await Promise.all(workers)
  return results
}

export { EMBED_BASE }
