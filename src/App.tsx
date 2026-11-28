import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { detectAppEnv, rememberAppEnv, isAppEnv } from './lib/appEnv'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { AuthProvider, useAuth } from './context/AuthContext'
import { HomePage } from './pages/HomePage'
import { CatalogPage } from './pages/CatalogPage'
import { SearchPage } from './pages/SearchPage'
import { TitleDetailPage } from './pages/TitleDetailPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordPages'
import { FavoritesPage, HistoryPage, ProfilePage } from './pages/AccountPages'
import ProfilesPage from './pages/ProfilesPage'
import ProfileGate from './components/ProfileGate'
import { SettingsPage, DownloadPage } from './pages/SettingsPages'
import { PlansPage } from './pages/PlansPage'
import { PixPaymentPage } from './pages/PixPaymentPage'
import { SeriesPage } from './pages/SeriesPage'

// Player e admin são pesados — carregados sob demanda.
const PlayerPage = lazy(() => import('./pages/PlayerPage').then((m) => ({ default: m.PlayerPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function PageFallback() {
  return (
    <div className="spinner-page">
      <div className="player-spinner" />
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const { profileEpoch } = useAuth()
  // Dentro do app instalado não existe navbar nem rodapé de site: o app tem a
  // própria navegação (barra inferior nativa) e o conteúdo ocupa a tela toda.
  // É o que impede o usuário de perceber que é um site dentro de um app.
  const [appMode] = useState(() => {
    const env = detectAppEnv()
    rememberAppEnv(env)
    return isAppEnv(env)
  })

  if (appMode) {
    // O Navbar é renderizado, mas o CSS de modo aplicativo esconde o cabeçalho
    // (`.nav`) e mantém a barra inferior (`.mobile-nav`) — que passa a ser a
    // navegação do app, como a tab bar de um aplicativo nativo.
    return (
      <>
        <Navbar />
        <main className="app-shell" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div key={profileEpoch} style={{ display: 'contents' }}>
            {children}
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* `key` no epoch: trocar de perfil remonta a tela e ela relê o catálogo
            já filtrado pelo modo infantil. */}
        <div key={profileEpoch} style={{ display: 'contents' }}>
          {children}
        </div>
      </main>
      <Footer />
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ScrollToTop />
      {/* Liga o perfil ativo ao modo infantil do catálogo (site inteiro). */}
      <ProfileGate />
      <Routes>
        {/* Player em tela cheia, sem navbar/footer */}
        <Route
          path="/assistir/:id"
          element={
            <Suspense fallback={<PageFallback />}>
              <PlayerPage />
            </Suspense>
          }
        />

        <Route
          path="*"
          element={
            <Shell>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/filmes" element={<CatalogPage kind="movie" />} />
                  <Route path="/series" element={<CatalogPage kind="tv" />} />
                  <Route path="/pesquisa" element={<SearchPage />} />
                  <Route path="/titulo/:type/:id" element={<TitleDetailPage />} />
                  <Route path="/serie/:id" element={<SeriesPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/cadastro" element={<SignupPage />} />
                  <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
                  <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
                  <Route path="/favoritos" element={<FavoritesPage />} />
                  <Route path="/historico" element={<HistoryPage />} />
                  <Route path="/perfil" element={<ProfilePage />} />
                  <Route path="/perfis" element={<ProfilesPage />} />
                  <Route path="/configuracoes" element={<SettingsPage />} />
                  <Route path="/planos" element={<PlansPage />} />
                  <Route path="/pagamento/pix" element={<PixPaymentPage />} />
                  <Route path="/baixar-app" element={<DownloadPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  {/* O app de TV não é mais distribuído pelo site público. */}
                  <Route path="/tv" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </Shell>
          }
        />
      </Routes>
    </AuthProvider>
  )
}

function NotFound() {
  return (
    <div className="page">
      <div className="empty">
        <h3>Página não encontrada</h3>
        <p>O endereço que você tentou abrir não existe.</p>
        <a href="/" className="btn btn--primary">
          Voltar ao início
        </a>
      </div>
    </div>
  )
}
