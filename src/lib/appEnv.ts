/**
 * Detecção de ambiente — site no navegador ou app instalado.
 *
 * O app Android e o app iOS são "cascas" que carregam o próprio site. Para o
 * site se comportar como um aplicativo de verdade dentro delas (sem barra de
 * navegador, sem cabeçalho de site, sem "abrir no navegador"), o frontend
 * precisa saber onde está rodando. A marca vem de três lugares, em ordem de
 * confiança:
 *
 *  1. `?app=android|ios` na URL — o app abre a página com esse parâmetro.
 *  2. User-Agent — os WebViews dos apps acrescentam `MovieFlixApp/…`.
 *  3. `sessionStorage` — guarda a marca durante a navegação interna, para não
 *     depender do parâmetro em cada troca de rota.
 *
 * É de propósito `sessionStorage` e não `localStorage`: um navegador que abrisse
 * `/baixar-app?app=ios` uma vez ficaria preso no modo app para sempre.
 *
 * Nada aqui libera conteúdo nem esconde dado: é só apresentação.
 */

export type AppEnv = 'web-desktop' | 'web-mobile' | 'app-android' | 'app-ios'

const STORAGE_KEY = 'mf_app_env'

/** Marca enviada pelo WebView de cada app. */
export const APP_UA_MARKER = 'MovieFlixApp/'

export function detectAppEnv(): AppEnv {
  if (typeof window === 'undefined') return 'web-desktop'

  const params = new URLSearchParams(window.location.search)
  const param = params.get('app')
  if (param === 'android') return 'app-android'
  if (param === 'ios') return 'app-ios'

  const ua = navigator.userAgent || ''
  if (new RegExp(APP_UA_MARKER.replace('/', '\\/'), 'i').test(ua)) {
    return /iPhone|iPad|iPod/i.test(ua) ? 'app-ios' : 'app-android'
  }

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY)
    if (stored === 'app-android' || stored === 'app-ios') return stored
  } catch {
    /* sessionStorage bloqueado — segue para o User-Agent */
  }

  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ? 'web-mobile' : 'web-desktop'
}

/** `true` quando a página está rodando dentro de um app instalado. */
export function isAppEnv(env: AppEnv = detectAppEnv()): boolean {
  return env === 'app-android' || env === 'app-ios'
}

/**
 * Guarda a marca do app para as próximas navegações da mesma aba.
 * Também marca o `<html>` com `data-mf-env`, que o CSS usa para aplicar o
 * layout de aplicativo (sem navbar de site, sem rodapé, com safe areas).
 */
export function rememberAppEnv(env: AppEnv): void {
  if (typeof window === 'undefined') return

  if (env === 'app-android' || env === 'app-ios') {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, env)
    } catch {
      /* sem sessionStorage: a detecção por UA continua funcionando */
    }
  }

  document.documentElement.setAttribute('data-mf-env', env)
}
