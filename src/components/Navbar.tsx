import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { SearchIcon, HomeIcon, FilmIcon, TvIcon, HeartIcon, ClockIcon, UserIcon, DownloadIcon } from './Icons'

const LINKS = [
  { to: '/', label: 'Início', icon: HomeIcon },
  { to: '/filmes', label: 'Filmes', icon: FilmIcon },
  { to: '/series', label: 'Séries', icon: TvIcon },
  { to: '/favoritos', label: 'Favoritos', icon: HeartIcon },
  { to: '/historico', label: 'Histórico', icon: ClockIcon },
]

export function Navbar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const isHome = pathname === '/'
  const transparent = isHome && !scrolled

  const initial = (profile?.full_name || user?.email || '?').trim().charAt(0).toUpperCase()

  return (
    <>
      <nav className={`nav ${transparent ? 'nav--transparent' : ''}`}>
        <Link to="/" className="nav-brand" aria-label="MovieFlix — início">
          <img src="/icon-192.png" alt="" />
          <span className="brand-word">MovieFlix</span>
        </Link>

        <div className="nav-links">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`nav-link ${pathname === l.to ? 'active' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="nav-actions">
          <button
            className="icon-btn"
            onClick={() => navigate('/pesquisa')}
            aria-label="Pesquisar"
            title="Pesquisar"
          >
            <SearchIcon size={20} />
          </button>
          <Link to="/baixar-app" className="icon-btn" aria-label="Baixar apps" title="Baixar apps">
            <DownloadIcon size={19} />
          </Link>
          {user ? (
            <Link to="/perfil" className="avatar-btn" aria-label="Minha conta" title="Minha conta">
              {initial}
            </Link>
          ) : (
            <Link to="/login" className="btn btn--primary btn--sm">
              Entrar
            </Link>
          )}
        </div>
      </nav>

      <nav className="mobile-nav" aria-label="Navegação principal">
        {LINKS.map((l) => {
          const Icon = l.icon
          return (
            <Link key={l.to} to={l.to} className={pathname === l.to ? 'active' : ''}>
              <Icon size={20} />
              <span>{l.label}</span>
            </Link>
          )
        })}
        <Link to={user ? '/perfil' : '/login'} className={pathname === '/perfil' ? 'active' : ''}>
          <UserIcon size={20} />
          <span>{user ? 'Conta' : 'Entrar'}</span>
        </Link>
      </nav>
    </>
  )
}
