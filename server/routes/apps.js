import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
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

/** Descrição pública dos apps (sem caminho de arquivo privado). */
const ANDROID_APK = path.join(ROOT, 'public', 'apk', 'movieflix-android.apk')

/** APK da TV — sempre privado. */
function tvApkPath() {
  const candidates = [
    path.join(PRIVATE_APPS_DIR, 'movieflix-tv.apk'),
    path.join(PRIVATE_APPS_DIR, 'movieflix-tv-1.0.3.apk'),
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
      available: apk.exists,
      version: '1.0.5',
      minAndroid: '8.0',
      sizeBytes: apk.sizeBytes,
      updatedAt: apk.updatedAt,
      url: '/apk/movieflix-android.apk',
    },
    ios: {
      // Instalação na tela de início: o site já é um PWA em tela cheia.
      available: true,
      minIos: '16.0',
      install: 'pwa',
    },
    tv: {
      available: tv.exists,
      version: '1.0.4',
      minAndroid: '8.0',
      sizeBytes: tv.sizeBytes,
      updatedAt: tv.updatedAt,
      url: '/api/apps/tv/download',
      /**
       * `beta` é o que a página lê para mostrar o selo. NÃO é decoração: o
       * app de TV ainda não foi validado num aparelho físico pelo proprietário,
       * e o aviso existe para que ninguém o trate como pronto.
       */
      status: 'beta',
      notice: 'Em desenvolvimento',
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
    return res.status(404).json({ error: 'APK da TV ainda não publicado no servidor.' })
  }
  res.type('application/vnd.android.package-archive')
  res.download(p, 'movieflix-tv.apk', (err) => {
    if (err && !res.headersSent) next(err)
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
    version: '1.0.3',
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
  res.download(p, 'movieflix-tv-1.0.3.apk', (err) => {
    if (err && !res.headersSent) next(err)
  })
})

export { router as appsRouter, publicRouter as publicAppsRouter }
