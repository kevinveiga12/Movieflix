import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useFavorites, useHistory, parseEpisodeId } from '../lib/userData'
import { loadCatalog, getById } from '../lib/catalog'
import { PosterCard } from '../components/PosterCard'
import { HeartIcon, ClockIcon, LogoutIcon, SettingsIcon, UserIcon, PlayIcon } from '../components/Icons'

export function FavoritesPage() {
  const { user } = useAuth()
  const { favorites, loading } = useFavorites()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    loadCatalog().then(() => setReady(true))
  }, [])

  if (!user) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon">
            <HeartIcon size={30} />
          </div>
          <h3>Entre para ver seus favoritos</h3>
          <p>Salve títulos para assistir depois. É grátis.</p>
          <Link to="/login" className="btn btn--primary">
            Entrar
          </Link>
        </div>
      </div>
    )
  }

  const items = favorites
    .map((f) => {
      const t = ready ? getById(String(f.tmdb_id), f.media_type) : undefined
      return t ?? null
    })
    .filter(Boolean)

  return (
    <div className="page" style={{ paddingTop: 32 }}>
      <div className="section-head">
        <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.2rem)' }}>
          Favoritos
        </h1>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {favorites.length} título(s)
        </span>
      </div>

      {loading || !ready ? (
        <div className="grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <HeartIcon size={30} />
          </div>
          <h3>Nenhum favorito ainda</h3>
          <p>Abra um título e toque em “Favoritar” para salvá-lo aqui.</p>
          <Link to="/filmes" className="btn btn--primary">
            Explorar filmes
          </Link>
        </div>
      ) : (
        <div className="grid">
          {items.map((t) => (
            <PosterCard key={`${t!.type}-${t!.tmdb_id}`} title={t!} />
          ))}
        </div>
      )}
    </div>
  )
}

export function HistoryPage() {
  const { user } = useAuth()
  const { history, loading, remove } = useHistory()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    loadCatalog().then(() => setReady(true))
  }, [])

  if (!user) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon">
            <ClockIcon size={30} />
          </div>
          <h3>Entre para ver seu histórico</h3>
          <p>Seu progresso fica salvo na sua conta.</p>
          <Link to="/login" className="btn btn--primary">
            Entrar
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page" style={{ paddingTop: 32 }}>
      <div className="section-head">
        <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.2rem)' }}>
          Histórico
        </h1>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {history.length} registro(s)
        </span>
      </div>

      {loading || !ready ? (
        <div className="grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : history.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <ClockIcon size={30} />
          </div>
          <h3>Nada assistido ainda</h3>
          <p>Os títulos que você assistir aparecem aqui.</p>
          <Link to="/" className="btn btn--primary">
            Ver catálogo
          </Link>
        </div>
      ) : (
        <div className="episode-list">
          {history.map((h) => {
            const t = getById(String(h.tmdb_id), h.media_type)
            const ep = parseEpisodeId(h.episode_id)
            const pct = h.duration_seconds ? Math.min(100, (h.position_seconds / h.duration_seconds) * 100) : 0
            return (
              <div key={h.id} className="episode" style={{ cursor: 'default' }}>
                <img
                  src={h.poster_url || '/icon-192.png'}
                  alt=""
                  style={{ width: 46, height: 66, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                />
                <div className="episode-info">
                  <div className="episode-title">{h.title}</div>
                  <div className="episode-sub">
                    {ep ? `T${ep.season} E${ep.episode} · ` : ''}
                    {Math.round(pct)}% assistido
                  </div>
                  <div className="progress-track" style={{ height: 3, marginTop: 8, maxWidth: 260 }}>
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="inline">
                  {t && (
                    <Link
                      to={`/assistir/${h.tmdb_id}?type=${h.media_type}${
                        ep ? `&season=${ep.season}&episode=${ep.episode}` : ''
                      }`}
                      className="btn btn--primary btn--sm"
                    >
                      <PlayIcon size={15} /> Continuar
                    </Link>
                  )}
                  <button
                    className="btn btn--outline btn--sm"
                    onClick={() => void remove(h.id)}
                    aria-label={`Remover ${h.title} do histórico`}
                  >
                    Remover
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ProfilePage() {
  const { user, profile, signOut, updateProfile } = useAuth()
  const navigate = useNavigate()
  const { favorites } = useFavorites()
  const { history } = useHistory()
  const [name, setName] = useState(profile?.name ?? '')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(profile?.name ?? '')
  }, [profile?.name])

  if (!user) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon">
            <UserIcon size={30} />
          </div>
          <h3>Você não está logado</h3>
          <p>Entre para acessar sua conta, favoritos e histórico.</p>
          <Link to="/login" className="btn btn--primary">
            Entrar
          </Link>
        </div>
      </div>
    )
  }

  const initial = (profile?.name || user.email || '?').charAt(0).toUpperCase()

  return (
    <div className="page" style={{ paddingTop: 32, maxWidth: 820 }}>
      <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.2rem)', marginBottom: 24 }}>
        Minha conta
      </h1>

      <div className="panel">
        <div className="row-between">
          <div className="inline" style={{ gap: 18 }}>
            <div className="avatar-lg">{initial}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                {profile?.name || 'Sem nome'}
              </div>
              <div className="muted" style={{ fontSize: '0.87rem' }}>
                {user.email}
              </div>
              <div className="inline" style={{ marginTop: 8, gap: 8 }}>
                <span className="badge badge--purple">Acesso gratuito</span>
                {profile?.is_admin && <span className="badge badge--red">Administrador</span>}
              </div>
            </div>
          </div>
          <div className="inline">
            <Link to="/configuracoes" className="btn btn--outline btn--sm">
              <SettingsIcon size={16} /> Configurações
            </Link>
            <button
              className="btn btn--outline btn--sm"
              onClick={async () => {
                await signOut()
                navigate('/')
              }}
            >
              <LogoutIcon size={16} /> Sair
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Estatísticas</div>
        <div className="inline" style={{ gap: 32, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{favorites.length}</div>
            <div className="muted" style={{ fontSize: '0.82rem' }}>
              Favoritos
            </div>
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{history.length}</div>
            <div className="muted" style={{ fontSize: '0.82rem' }}>
              Títulos no histórico
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Dados do perfil</div>
        <p className="panel-sub">Seu nome aparece na sua conta.</p>
        {saved && <div className="alert alert--success">Perfil atualizado.</div>}
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            const { error } = await updateProfile({ name: name.trim() })
            setBusy(false)
            if (!error) {
              setSaved(true)
              setTimeout(() => setSaved(false), 3000)
            }
          }}
        >
          <div className="field">
            <label htmlFor="fullname">Nome</label>
            <input
              id="fullname"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
            />
          </div>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </form>
      </div>

      {profile?.is_admin && (
        <div className="panel">
          <div className="panel-title">Administração</div>
          <p className="panel-sub">Gerencie catálogo, usuários e conteúdo.</p>
          <Link to="/admin" className="btn btn--primary">
            Abrir painel administrativo
          </Link>
        </div>
      )}
    </div>
  )
}
