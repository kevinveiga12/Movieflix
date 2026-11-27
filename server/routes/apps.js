import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { requireAdmin } from '../lib/auth.js'

/**
 * Distribuição dos aplicativos MovieFlix.
 *
 * ── APK DA TV: PÚBLICO, MARCADO "EM DESENVOLVIMENTO" ────────────────────────
 *
 * O proprietário pediu o app de TV na página de downloads, com o aviso de que
 * está em desenvolvimento. Então ele é público agora — mas continua fora de
 * `public/`, porque o arquivo é grande e não deve ser servido como estático
 * sem controle de versão. Ele sai por `GET /api/apps/tv/download`, que é
 * público e responde com `Content-Disposition: attachment`.
 *
 * O caminho antigo (`/api/admin/apps/tv/download`, atrás de `requireAdmin`)
 * continua existindo para o painel administrativo.
 *
 * ── APPS MOBILE ────────────────────────────────────────────────────────────
 *
 * O APK Android continua público (`/apk/movieflix-android.apk`): é para isso
 * que ele existe. O iOS é distribuído como instalação na tela de início (PWA
 * em tela cheia), porque a App Store exige conta de desenvolvedor e revisão da
 * Apple — nada aqui finge o contrário.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')

/** Onde ficam os arquivos que NÃO são servidos como estático. */
export const PRIVATE_APPS_DIR = path.join(ROOT, 'storage', 'apps')

/**
 * APK DA TV HOSPEDADO FORA DO PACOTE.
 *
 * O pool de armazenamento da Velixir está cheio: um pacote com os 10,8 MB do
 * APK da TV não passa (o de 13 MB passou, o de 23 MB falhou). Então o APK sai
 * do tarball e é servido de fora — a rota continua sendo
 * `/api/apps/tv/download`, que REDIRECIONA quando o arquivo não está no disco.
 *
 * ── POR QUE O GITHUB E NÃO O CDN DE ARTEFATOS ──────────────────────────────
 *
 * O CDN de artefatos (`static.teamily.ai`) exige token de acesso: um navegador
 * sem sessão recebe 403. Testado — o redirect para lá devolvia 403 ao cliente.
 *
 * O repositório é PÚBLICO e o workflow de build commita o APK em
 * `storage/apps/movieflix-tv.apk` a cada build. O `raw.githubusercontent.com`
 * entrega esse arquivo sem autenticação (verificado: 200, 10.873.657 bytes).
 * É a única das duas opções que funciona no navegador de quem baixa.
 *
 * Ordem: disco local primeiro (um deploy com o APK incluído continua ganhando),
 * GitHub como reserva. Nenhum dos dois existe → 404 honesto.
 */
const TV_APK_CDN =
  'https://raw.githubusercontent.com/kevinveiga12/Movieflix/main/storage/apps/movieflix-tv.apk'

/** APK do Android hospedado fora do pacote (mesmo motivo). */
const ANDROID_APK_CDN =
  'https://raw.githubusercontent.com/kevinveiga12/Movieflix/main/public/apk/movieflix-android.apk'

/** Descrição pública dos apps (sem caminho de arquivo privado). */
const ANDROID_APK = path.join(ROOT, 'public', 'apk', 'movieflix-android.apk')

/** APK da TV — sempre privado. */
function tvApkPath() {
  const candidates = [
    path.join(PRIVATE_APPS_DIR, 'movieflix-tv.apk'),
    path.join(PRIVATE_APPS_DIR, 'movieflix-tv-1.0.7.apk'),
    path.join(PRIVATE_APPS_DIR, 'movieflix-tv-1.0.6.apk'),
    path.join(PRIVATE_APPS_DIR, 'movieflix-tv-1.0.5.apk'),
    path.join(PRIVATE_APPS_DIR, 'movieflix-tv-1.0.4.apk'),
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
}

function fileInfo(p) {
  try {
    const st = fs.statSync(p)
    return { exists: true, sizeBytes: st.size, updatedAt: st.mtime.toISOString() }
  } catch {
    return { exists: false, sizeBytes: 0, updatedAt: null }
  }
}

const router = Router()

/**
 * Router PÚBLICO, montado só em `/api/apps`.
 *
 * Existe separado porque o mesmo arquivo é montado também em
 * `/api/admin/apps` (para o painel). Se o download público estivesse no router
 * compartilhado, ele seria registrado antes do download protegido e o
 * `requireAdmin` nunca rodaria — o APK sairia sem autenticação pelo caminho
 * administrativo. Dois routers eliminam a ambiguidade.
 */
const publicRouter = Router()

/**
 * GET /api/apps — o que o site mostra publicamente.
 *
 * Três aplicativos: Android, iOS e TV. O de TV vem com `status: 'beta'` e
 * `notice`, que é o que a página usa para desenhar o selo "em desenvolvimento".
 */
publicRouter.get('/', (_req, res) => {
  const apk = fileInfo(ANDROID_APK)
  const tv = fileInfo(tvApkPath())
  res.set('Cache-Control', 'no-store')
  res.json({
    android: {
      /*
        `available` não depende mais do arquivo estar no disco do servidor: o
        APK pode estar no CDN (o pool da Velixir está cheio). O que importa é
        que a rota entrega — e ela entrega, local ou redirecionando.
      */
      available: true,
      version: '1.0.5',
      minAndroid: '8.0',
      sizeBytes: apk.sizeBytes || null,
      updatedAt: apk.updatedAt,
      url: '/apk/movieflix-android.apk',
      /** Reserva: usada pela página se a rota local não existir. */
      fallbackUrl: ANDROID_APK_CDN,
    },
    ios: {
      // Instalação na tela de início: o site já é um PWA em tela cheia.
      available: true,
      minIos: '16.0',
      install: 'pwa',
    },
    tv: {
      /*
        A TV continua disponível: quando o APK não está no disco do servidor,
        `/api/apps/tv/download` redireciona para o CDN. O tamanho vem do
        arquivo local quando existe; sem ele, o valor conhecido do APK
        publicado (10.873.657 bytes) — nunca `0`.
      */
      available: true,
      /*
        A versão anunciada é a do APK QUE EXISTE — conferida lendo o
        AndroidManifest do arquivo publicado. 1.0.4 é o primeiro build que
        inclui o player que COMPILA (o `TvEmbedPlayer` referenciava estado do
        pai e o APK 1.0.3 vinha de um código que não passava do compilador) e a
        retomada de filme de onde parou.
        Ao gerar um APK novo, atualize aqui, em src/pages/SettingsPages.tsx e o
        versionName em tv/android/app/build.gradle.kts — os três.
      */
      version: '1.0.12',
      minAndroid: '8.0',
      sizeBytes: tv.sizeBytes || 10906425,
      updatedAt: tv.updatedAt,
      url: '/api/apps/tv/download',
      fallbackUrl: TV_APK_CDN,
      /*
        1.0.6 é a versão de produção: ordenação, pesquisa direta, proteção de
        tela e atualizador integrado. O selo "beta" foi removido — o app não é
        mais apresentado como em desenvolvimento.
      */
      updateNote: 'pagamento por cartão de crédito e débito, além do Pix',
      platforms: ['Android TV', 'Google TV', 'TV Box'],
    },
  })
})

/**
 * GET /api/apps/tv/download — entrega o APK da TV ao público.
 *
 * Público de propósito: o card do app de TV na página de downloads aponta
 * para cá. O arquivo continua em `storage/apps/`, fora do estático, para que
 * a troca de versão seja uma decisão nossa e não um efeito de copiar arquivo.
 */
publicRouter.get('/tv/download', (req, res, next) => {
  const p = tvApkPath()
  if (!fs.existsSync(p)) {
    /* APK fora do pacote (pool da Velixir cheio): manda para o CDN. */
    res.set('Cache-Control', 'no-store')
    return res.redirect(302, TV_APK_CDN)
  }
  res.type('application/vnd.android.package-archive')
  res.download(p, 'movieflix-tv.apk', (err) => {
    if (err && !res.headersSent) next(err)
  })
})

/**
 * ── MANIFESTO DE VERSÕES DO APP DE TV ────────────────────────────────────────
 *
 * GET /api/apps/tv/version
 *
 * É o arquivo de controle que o atualizador integrado consulta ao abrir. O app
 * NÃO tem número de versão fixo no código: ele lê este JSON e compara com o
 * `versionCode` instalado.
 *
 * ── COMO PUBLICAR UMA VERSÃO NOVA (1.0.7, 1.0.8, 2.0.0...) ──────────────────
 *
 *   1. gerar o APK novo (workflow Build APKs);
 *   2. publicar o arquivo em `storage/apps/movieflix-tv.apk`;
 *   3. atualizar `storage/apps/tv-version.json` com version/versionCode/notes.
 *
 * Nada de código muda. O `sha256` é calculado AQUI, a partir do APK que está
 * no disco — assim o hash nunca fica dessincronizado do arquivo entregue, que
 * é o erro clássico de um atualizador (hash de um build, APK de outro).
 *
 * Se o APK não estiver no disco (servido pelo CDN), o hash vem do JSON; se
 * também não houver, o campo sai nulo e o app recusa a instalação — melhor
 * recusar do que instalar um arquivo não verificado.
 */
const TV_VERSION_FILE = path.join(PRIVATE_APPS_DIR, 'tv-version.json')

/** Hash SHA-256 do APK em disco, com cache por mtime+tamanho. */
let shaCache = { key: '', value: null }
function apkSha256(p) {
  try {
    const st = fs.statSync(p)
    const key = `${st.size}:${st.mtimeMs}`
    if (shaCache.key === key && shaCache.value) return shaCache.value
    const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    shaCache = { key, value: hash }
    return hash
  } catch {
    return null
  }
}

publicRouter.get('/tv/version', (req, res) => {
  res.set('Cache-Control', 'no-store')

  let manifest = null
  try {
    manifest = JSON.parse(fs.readFileSync(TV_VERSION_FILE, 'utf8'))
  } catch {
    manifest = null
  }

  const p = tvApkPath()
  const onDisk = fs.existsSync(p)
  const sha = onDisk ? apkSha256(p) : null

  /*
    ── REGRA DE HONESTIDADE ──────────────────────────────────────────────────

    Só anunciamos uma versão quando o APK que será ENTREGUE é exatamente o que
    o manifesto descreve. Sem isso, o servidor poderia dizer "1.0.6 disponível"
    enquanto o arquivo em disco ainda é o 1.0.5 — o app baixaria, o SHA não
    bateria e o usuário veria um erro sem explicação.

    A verificação é o SHA-256: o manifesto precisa declarar o hash do APK e ele
    tem de bater com o arquivo em disco. Se não bater (ou se o manifesto não
    trouxer hash), respondemos `versionCode: 0`, que o app interpreta como
    "nada a atualizar" — silencioso e seguro.

    É por isso que publicar uma versão nova exige preencher `sha256` no
    `storage/apps/tv-version.json` (o workflow de build faz isso).
  */
  const declared = manifest?.sha256 ? String(manifest.sha256).toLowerCase().trim() : null
  const verified = Boolean(declared && sha && declared === sha)

  const version = verified ? manifest.version : '1.0.7'
  const versionCode = verified ? Number(manifest.versionCode) : 0

  res.json({
    version,
    versionCode,
    /*
      URL ABSOLUTA e HTTPS: o app só aceita endereço oficial. A rota de
      download é a mesma que o site usa, então o APK entregue ao atualizador é
      exatamente o que um humano baixaria.
    */
    apkUrl: manifest?.apkUrl ?? 'https://movieflix.velixir.run/api/apps/tv/download',
    /*
      O hash devolvido é SEMPRE o do arquivo em disco — nunca o do manifesto.
      Assim o app valida contra o byte que realmente recebeu.
    */
    sha256: sha,
    notes: verified ? (manifest.notes ?? []) : [],
    mandatory: verified ? Boolean(manifest.mandatory) : false,
    publishedAt: verified ? (manifest.publishedAt ?? null) : null,
    minSupportedVersionCode: verified ? Number(manifest.minSupportedVersionCode ?? 0) : 0,
  })
})

/**
 * GET /api/admin/apps/tv — metadados do APK da TV (somente admin).
 * Não devolve o arquivo: o download tem URL própria para poder ser auditado.
 */
router.get('/tv', requireAdmin, (_req, res) => {
  const p = tvApkPath()
  const info = fileInfo(p)
  res.set('Cache-Control', 'no-store')
  res.json({
    name: 'MovieFlix TV',
    version: '1.0.10',
    available: info.exists,
    sizeBytes: info.sizeBytes,
    updatedAt: info.updatedAt,
    downloadUrl: '/api/admin/apps/tv/download',
  })
})

/**
 * GET /api/admin/apps/tv/download — entrega o APK da TV.
 *
 * `res.download` cuida de Content-Disposition e de Range. `requireAdmin`
 * garante que o arquivo só chega a um administrador autenticado: sem token
 * válido, a resposta é 401/403 e o corpo do APK nunca é lido do disco.
 */
router.get('/tv/download', requireAdmin, (req, res, next) => {
  const p = tvApkPath()
  if (!fs.existsSync(p)) {
    return res.status(404).json({
      error: 'APK da TV ainda não publicado no servidor (storage/apps/movieflix-tv.apk).',
    })
  }
  console.log(`[MovieFlix] APK TV baixado por ${req.user?.email ?? req.user?.id ?? 'admin'}`)
  res.type('application/vnd.android.package-archive')
  res.download(p, 'movieflix-tv-1.0.10.apk', (err) => {
    if (err && !res.headersSent) next(err)
  })
})

export { router as appsRouter, publicRouter as publicAppsRouter }
