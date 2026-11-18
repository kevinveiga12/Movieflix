import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initSupabase } from './lib/supabase'
import './styles/global.css'

/**
 * O Supabase é inicializado ANTES de renderizar.
 *
 * A configuração vem de GET /api/config (runtime), então precisa de um fetch.
 * Se renderizássemos primeiro, o AuthProvider chamaria `supabase` antes do
 * cliente existir. O boot espera a resolução e só então monta a árvore.
 */
async function boot() {
  await initSupabase()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  )
}

void boot()

// Registra o service worker (PWA) apenas em produção.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[MovieFlix] service worker não registrado:', e)
    })
  })
}
