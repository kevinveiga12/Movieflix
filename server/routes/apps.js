import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireAdmin } from '../lib/auth.js'

/**
 * Distribuição dos aplicativos MovieFlix.
 *
 * ── POR QUE O APK DA TV NÃO FICA EM `public/` ──────────────────────────────
 *
 * O APK da TV era servido como arquivo estático (`public/apk/…`), então
 * qualquer visitante que descobrisse o caminho baixava — e a página
 * `/baixar-app` publicava o link para todo mundo. O pedido é que o aplicativo
 * de TV seja distribuído **somente ao administrador**.
 *
 * Arquivo em `public/` (ou em `dist/`) é público por definição: o Express o
 * entrega antes de qualquer rota. Por isso o APK foi movido para
 * `storage/apps/`, que não é servido estaticamente, e só sai daqui pela rota
 * `GET /api/admin/apps/tv/download`, atrás de `requireAdmin` — que valida o
 * Bearer token no Supabase e exige `profiles.is_admin` (com a barreira extra
 * de ADMIN_EMAILS quando configurada).
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
 * GET /api/apps — o que o site pode mostrar publicamente.
 *
 * Só o Android aparece aqui. O app de TV NÃO é listado: a existência dele não
 * é divulgada no site público, e o download exige admin.
 */
router.get('/', (_req, res) => {
  const apk = fileInfo(ANDROID_APK)
  res.set('Cache-Control', 'no-store')
  res.json({
    android: {
      available: apk.exists,
      version: '1.0.4',
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
  })
})

/**
 * GET /api/admin/apps/tv — metadados do APK da TV (somente admin).
 * Não devolve o arquivo: o download tem URL própria para poder ser auditado.
 */
router.get('/admin/tv', requireAdmin, (_req, res) => {
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
router.get('/admin/tv/download', requireAdmin, (req, res, next) => {
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

export { router as appsRouter }
