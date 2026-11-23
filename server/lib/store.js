import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Armazenamento das edições administrativas.
 *
 * IMPORTANTE — por que um arquivo e não uma tabela nova:
 * o pedido exige preservar o Supabase antigo e NÃO criar tabelas sem aprovação
 * prévia. Então as edições do painel vivem em um JSON no servidor
 * (server/data/catalog-overrides.json), aplicado por cima do catálogo base.
 *
 * Vantagens: zero migração, zero risco ao banco, reversível (basta apagar o
 * arquivo). Se o proprietário aprovar uma tabela `catalog_overrides` no futuro,
 * só esta camada muda — o resto do código continua igual.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Onde ficam os arquivos de edição.
 *
 * `MOVIEFLIX_DATA_DIR` permite apontar para um volume persistente da Velixir
 * sem mudar código. Sem a variável, usa `server/data/` (o mesmo lugar de antes).
 */
const DATA_DIR = process.env.MOVIEFLIX_DATA_DIR
  ? path.resolve(process.env.MOVIEFLIX_DATA_DIR)
  : path.join(__dirname, '..', 'data')
const OVERRIDES = path.join(DATA_DIR, 'catalog-overrides.json')
const ADMIN_CONFIG = path.join(DATA_DIR, 'admin-config.json')

/**
 * BASELINE versionado dos títulos ocultos.
 *
 * `catalog-overrides.json` está no .gitignore (é estado de runtime), então um
 * deploy traria o arquivo vazio e os títulos ocultados voltariam a aparecer.
 * Este baseline é COMITADO no repositório e serve de semente: na primeira
 * leitura, se o arquivo de runtime não existir, ele é criado a partir daqui.
 *
 * Assim o que foi ocultado por verificação sobrevive a todo deploy, e o que o
 * painel ocultar depois vive no arquivo de runtime.
 */
/** Arquivo gerado pelo build com os títulos quebrados (ver scripts/verificar-no-build.mjs). */
const BROKEN_REPORT = path.join(__dirname, '..', '..', 'public', 'filmes', 'quebrados.json')

const BASELINE = path.join(__dirname, '..', 'data', 'hidden-baseline.json')

const EMPTY = { movies: {}, series: {}, hidden: [], updatedAt: null }

/**
 * Configuração administrativa (planos e preços).
 *
 * Mesma razão do arquivo de overrides: a tabela `plans` não existe no Supabase
 * atual e o pedido proíbe criar tabelas sem autorização. O painel grava aqui e
 * a rota /api/plans lê daqui ANTES do banco — assim o preço alterado no painel
 * vale no site imediatamente, sem migração e sem rebuild.
 *
 * Formato:
 *   { plans: { basico: { price_cents, discount_3m, discount_12m, is_active }, ... } }
 */
const EMPTY_CONFIG = { plans: {}, updatedAt: null }

export async function readAdminConfig() {
  try {
    const raw = await fs.readFile(ADMIN_CONFIG, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...EMPTY_CONFIG, ...parsed, plans: { ...(parsed.plans ?? {}) } }
  } catch {
    return { ...EMPTY_CONFIG, plans: {} }
  }
}

export async function writeAdminConfig(data) {
  await ensureDir()
  const payload = { ...data, updatedAt: new Date().toISOString() }
  await fs.writeFile(ADMIN_CONFIG, JSON.stringify(payload, null, 2), 'utf8')
  return payload
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TÍTULOS OCULTOS — formato e compatibilidade
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A versão anterior guardava `hidden` como uma lista de IDs soltos
 * (`["1550338", "603"]`). Isso tinha dois problemas:
 *
 *   1. não dizia se o ID era filme ou série — um mesmo número podia existir
 *      nos dois catálogos e o filtro escondia os dois;
 *   2. não guardava o motivo nem a origem, então não havia como auditar nem
 *      desfazer com contexto.
 *
 * O formato novo é uma lista de objetos:
 *
 *   { tmdb_id: "1550338", type: "movie", title: "Visões de um Amor",
 *     poster_url: "https://…", motivo: "abre a tela de erro",
 *     origem: "manual" | "auto" | "verificacao", em: "2026-11-23T…" }
 *
 * `type: null` significa "esconde nos dois catálogos" — é o que a lista antiga
 * de IDs soltos vira na leitura, para não perder o que já estava oculto.
 *
 * `title` e `poster_url` são gravados NO MOMENTO de ocultar. Isso é de
 * propósito: o painel consegue listar os ocultos sem varrer o catálogo de 27 MB
 * (o processo vive com 160 MB de heap no plano Free da Velixir).
 */
function normalizeHidden(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    let entry = null
    if (typeof item === 'string' || typeof item === 'number') {
      // Formato antigo: ID solto, sem tipo.
      entry = { tmdb_id: String(item), type: null }
    } else if (item && typeof item === 'object') {
      const id = String(item.tmdb_id ?? item.id ?? '').trim()
      if (!id) continue
      const type = item.type === 'movie' || item.type === 'tv' ? item.type : null
      entry = {
        tmdb_id: id,
        type,
        title: typeof item.title === 'string' ? item.title : '',
        poster_url: typeof item.poster_url === 'string' ? item.poster_url : '',
        motivo: typeof item.motivo === 'string' ? item.motivo : '',
        origem: typeof item.origem === 'string' ? item.origem : 'manual',
        em: typeof item.em === 'string' ? item.em : null,
      }
    }
    if (!entry) continue
    const key = `${entry.type ?? '*'}:${entry.tmdb_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

export async function readOverrides() {
  const [runtime, baseline, broken] = await Promise.all([
    readRuntimeOverrides(),
    readBaselineFile(),
    readBrokenReport(),
  ])

  // A lista de ocultos é a UNIÃO das três fontes. Nenhuma sobrescreve a outra,
  // porque cada uma responde por um caminho diferente:
  //
  //   runtime  → o que o dono ocultou no painel (arquivo local)
  //   baseline → o que veio comitado no código (sobrevive ao deploy)
  //   broken   → o que a verificação do build descobriu nesta versão
  //
  // A ordem importa: runtime primeiro, então um registro do painel tem
  // precedência quando o mesmo título aparece em mais de uma fonte (é o
  // normalizeHidden que deduplica).
  return {
    movies: runtime.movies,
    series: runtime.series,
    hidden: normalizeHidden([...runtime.hidden, ...baseline.hidden, ...broken]),
    updatedAt: runtime.updatedAt ?? baseline.updatedAt ?? null,
  }
}

/** Lê só o arquivo de runtime (o que o painel gravou). */
async function readRuntimeOverrides() {
  try {
    const raw = await fs.readFile(OVERRIDES, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      ...EMPTY,
      ...parsed,
      movies: { ...(parsed.movies ?? {}) },
      series: { ...(parsed.series ?? {}) },
      hidden: normalizeHidden(parsed.hidden),
    }
  } catch {
    return { ...EMPTY, hidden: [] }
  }
}

/**
 * Lê o baseline comitado no repositório.
 *
 * Devolve o mesmo formato de `readOverrides`. Se o baseline também não existir
 * (primeira instalação), devolve vazio — o site mostra o catálogo completo em
 * vez de quebrar.
 */
async function readBaselineFile() {
  try {
    const raw = await fs.readFile(BASELINE, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      ...EMPTY,
      ...parsed,
      movies: { ...(parsed.movies ?? {}) },
      series: { ...(parsed.series ?? {}) },
      hidden: normalizeHidden(parsed.hidden),
    }
  } catch {
    return { ...EMPTY, hidden: [] }
  }
}

/** Lê a lista de quebrados que o build gerou. Ausente = lista vazia. */
async function readBrokenReport() {
  try {
    const parsed = JSON.parse(await fs.readFile(BROKEN_REPORT, 'utf8'))
    const itens = Array.isArray(parsed?.itens) ? parsed.itens : []
    return itens.map((i) => ({
      tmdb_id: String(i.tmdb_id ?? ''),
      type: i.type === 'tv' || i.type === 'series' ? 'tv' : 'movie',
      title: i.title ?? '',
      poster_url: i.poster_url ?? '',
      motivo: i.motivo ?? 'embed sem fonte (verificação do build)',
      origem: 'verificacao',
      em: parsed.gerado_em ?? null,
    }))
  } catch {
    return []
  }
}

export async function writeOverrides(data) {
  await ensureDir()
  const payload = {
    ...data,
    hidden: normalizeHidden(data.hidden),
    updatedAt: new Date().toISOString(),
  }
  await fs.writeFile(OVERRIDES, JSON.stringify(payload, null, 2), 'utf8')
  return payload
}

/**
 * Conjunto de IDs ocultos para um catálogo.
 *
 * `kind` é 'movie' ou 'series' (o nome do bucket). Uma entrada com `type: null`
 * vale para os dois — é assim que a lista antiga de IDs soltos continua
 * funcionando.
 */
export function hiddenIds(overrides, kind) {
  const wanted = kind === 'movie' ? 'movie' : 'tv'
  const set = new Set()
  for (const entry of overrides.hidden ?? []) {
    if (entry.type && entry.type !== wanted) continue
    set.add(String(entry.tmdb_id))
  }
  return set
}

/** Aplica overrides sobre uma lista de títulos. */
export function applyOverrides(list, overrides, kind) {
  const map = kind === 'movie' ? overrides.movies : overrides.series
  const hidden = hiddenIds(overrides, kind)
  const out = []
  for (const t of list) {
    const key = String(t.tmdb_id ?? t.id)
    if (hidden.has(key)) continue
    const patch = map[key]
    out.push(patch ? { ...t, ...patch } : t)
  }
  return out
}

/**
 * Adiciona (ou atualiza) um título na lista de ocultos.
 *
 * Idempotente: ocultar duas vezes o mesmo título não duplica a entrada, só
 * atualiza motivo/origem. Devolve o overrides já gravado.
 */
export async function hideTitle({ tmdbId, type, title, posterUrl, motivo, origem }) {
  const id = String(tmdbId ?? '').trim()
  if (!/^\d+$/.test(id)) throw new Error('ID inválido.')
  const kind = type === 'tv' || type === 'series' ? 'tv' : 'movie'

  const overrides = await readOverrides()
  const list = overrides.hidden.filter(
    (e) => !(String(e.tmdb_id) === id && (e.type === kind || e.type === null)),
  )
  list.push({
    tmdb_id: id,
    type: kind,
    title: String(title ?? '').slice(0, 300),
    poster_url: String(posterUrl ?? '').slice(0, 500),
    motivo: String(motivo ?? '').slice(0, 500),
    origem: origem === 'auto' || origem === 'verificacao' ? origem : 'manual',
    em: new Date().toISOString(),
  })
  overrides.hidden = list
  return writeOverrides(overrides)
}

/** Remove um título da lista de ocultos (reexibir). */
export async function unhideTitle({ tmdbId, type }) {
  const id = String(tmdbId ?? '').trim()
  const kind = type === 'tv' || type === 'series' ? 'tv' : type === 'movie' ? 'movie' : null
  const overrides = await readOverrides()
  overrides.hidden = overrides.hidden.filter((e) => {
    if (String(e.tmdb_id) !== id) return true
    // Sem tipo informado: remove a entrada daquele ID em qualquer catálogo.
    if (!kind) return false
    // Com tipo: remove a entrada específica e também a genérica (type null),
    // senão o título continuaria oculto pelo registro antigo.
    return e.type !== null && e.type !== kind
  })
  return writeOverrides(overrides)
}
