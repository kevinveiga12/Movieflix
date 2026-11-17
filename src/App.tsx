import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { AuthProvider } from './context/AuthContext'
import { HomePage } from './pages/HomePage'
import { CatalogPage } from './pages/CatalogPage'
import { SearchPage } from './pages/SearchPage'
import { TitleDetailPage } from './pages/TitleDetailPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordPages'
import { FavoritesPage, HistoryPage, ProfilePage } from './pages/AccountPages'
import { SettingsPage, DownloadPage } from './pages/SettingsPages'

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
  return (
    <>
      <Navbar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</main>
      <Footer />
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ScrollToTop />
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
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/cadastro" element={<SignupPage />} />
                  <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
                  <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
                  <Route path="/favoritos" element={<FavoritesPage />} />
                  <Route path="/historico" element={<HistoryPage />} />
                  <Route path="/perfil" element={<ProfilePage />} />
                  <Route path="/configuracoes" element={<SettingsPage />} />
                  <Route path="/baixar-app" element={<DownloadPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="/tv" element={<Navigate to="/baixar-app" replace />} />
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
