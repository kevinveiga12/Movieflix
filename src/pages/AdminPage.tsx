import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { loadCatalog, getAll, getById } from '../lib/catalog'
import { supabase } from '../lib/supabase'
import { CheckIcon, XIcon, SearchIcon, SettingsIcon, UserIcon, FilmIcon } from '../components/Icons'
import type { Title } from '../lib/types'

type Tab = 'overview' | 'catalog' | 'users'

interface Stats {
  users: number
  favorites: number
  history: number
  editedMovies: number
  editedSeries: number
  hidden: number
  updatedAt: string | null
}

interface AdminUser {
  id: string
  email: string | null
  full_name: string | null
  is_admin: boolean
  created_at: string
}

export function AdminPage() {
  const { user, profile, loading, session } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Title | null>(null)

  useEffect(() => {
    loadCatalog().then(() => setReady(true))
  }, [])

  const token = session?.access_token

  async function api(path: string, init?: RequestInit) {
    const res = await fetch(`/api/admin${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`)
    return data
  }

  useEffect(() => {
    if (!token || !profile?.is_admin) return
    let alive = true
    ;(async () => {
      try {
        const s = await api('/stats')
        if (alive) setStats(s)
        const u = await api('/users?limit=100')
        if (alive) setUsers(u.users ?? [])
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, profile?.is_admin])

  const results = useMemo(() => {
    if (!ready) return []
    const q = query.trim().toLowerCase()
    if (!q) return []
    return getAll()
      .filter((t) => t.title.toLowerCase().includes(q))
      .slice(0, 40)
  }, [ready, query])

  if (loading) {
    return (
      <div className="page">
        <div className="spinner-page">
          <div className="player-spinner" />
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon">
            <UserIcon size={30} />
          </div>
          <h3>Entre para acessar o painel</h3>
          <p>O painel administrativo exige uma conta com permissão de administrador.</p>
          <Link to="/login" className="btn btn--primary">
            Entrar
          </Link>
        </div>
      </div>
    )
  }

  if (!profile?.is_admin) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon">
            <XIcon size={30} />
          </div>
          <h3>Acesso restrito</h3>
          <p>
            Sua conta não tem permissão de administrador. A permissão é verificada no banco de
            dados (profiles.is_admin) e no servidor — não pode ser alterada pelo navegador.
          </p>
          <Link to="/" className="btn btn--outline">
            Voltar ao início
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page" style={{ paddingTop: 32 }}>
      <div className="section-head">
        <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.2rem)' }}>
          Painel administrativo
        </h1>
        <span className="badge badge--red">Administrador</span>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="filters">
        {(
          [
            ['overview', 'Visão geral'],
            ['catalog', 'Catálogo'],
            ['users', 'Usuários'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
            {[
              ['Usuários', stats?.users ?? '—'],
              ['Favoritos', stats?.favorites ?? '—'],
              ['Histórico', stats?.history ?? '—'],
              ['Filmes editados', stats?.editedMovies ?? '—'],
              ['Séries editadas', stats?.editedSeries ?? '—'],
              ['Ocultos', stats?.hidden ?? '—'],
            ].map(([label, value]) => (
              <div key={String(label)} className="panel" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: '1.9rem', fontWeight: 800 }}>{value}</div>
                <div className="muted" style={{ fontSize: '0.82rem' }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          <div className="panel" style={{ marginTop: 20 }}>
            <div className="panel-title">Como o catálogo funciona</div>
            <p className="panel-sub" style={{ marginBottom: 0 }}>
              O catálogo base vem do TMDB (gerado por <code>scripts/gerar-catalogo.mjs</code>). As
              edições feitas aqui são gravadas em <code>server/data/catalog-overrides.json</code> e
              aplicadas por cima do catálogo base — sem alterar o banco de dados nem o Supabase.
              {stats?.updatedAt && (
                <>
                  <br />
                  Última alteração: {new Date(stats.updatedAt).toLocaleString('pt-BR')}
                </>
              )}
            </p>
          </div>
        </>
      )}

      {tab === 'catalog' && (
        <>
          <div className="search-bar" style={{ margin: '0 0 20px', maxWidth: '100%' }}>
            <SearchIcon size={20} />
            <input
              type="search"
              placeholder="Buscar título no catálogo para editar…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {query && results.length === 0 && <p className="muted">Nenhum título encontrado.</p>}

          <div className="episode-list">
            {results.map((t) => (
              <div key={`${t.type}-${t.tmdb_id}`} className="episode" style={{ cursor: 'default' }}>
                <img
                  src={t.poster_url || '/icon-192.png'}
                  alt=""
                  style={{ width: 40, height: 58, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                />
                <div className="episode-info">
                  <div className="episode-title">{t.title}</div>
                  <div className="episode-sub">
                    {t.type === 'movie' ? 'Filme' : 'Série'} · {t.year} · {t.category}
                    {t.video_url ? ' · com fonte' : ' · sem fonte'}
                  </div>
                </div>
                <button className="btn btn--outline btn--sm" onClick={() => setEditing(t)}>
                  <SettingsIcon size={15} /> Editar
                </button>
              </div>
            ))}
          </div>

          {!query && (
            <div className="empty">
              <div className="empty-icon">
                <FilmIcon size={30} />
              </div>
              <h3>Busque um título</h3>
              <p>Digite o nome para editar metadados, adicionar fonte de vídeo ou ocultar do catálogo.</p>
            </div>
          )}
        </>
      )}

      {tab === 'users' && (
        <div className="episode-list">
          {users.length === 0 && <p className="muted">Nenhum usuário carregado.</p>}
          {users.map((u) => (
            <div key={u.id} className="episode" style={{ cursor: 'default' }}>
              <div className="episode-num" style={{ background: 'rgba(139,92,246,.14)', color: '#c4b5fd' }}>
                {(u.full_name || u.email || '?').charAt(0).toUpperCase()}
              </div>
              <div className="episode-info">
                <div className="episode-title">{u.full_name || 'Sem nome'}</div>
                <div className="episode-sub">
                  {u.email} · desde {new Date(u.created_at).toLocaleDateString('pt-BR')}
                </div>
              </div>
              {u.is_admin && <span className="badge badge--red">Admin</span>}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditModal
          title={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await api(`/overrides/${editing.type === 'movie' ? 'movie' : 'series'}/${editing.tmdb_id}`, {
              method: 'PUT',
              body: JSON.stringify(patch),
            })
            setEditing(null)
            window.location.reload()
          }}
        />
      )}
    </div>
  )
}

function EditModal({
  title,
  onClose,
  onSave,
}: {
  title: Title
  onClose: () => void
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [form, setForm] = useState({
    title: title.title,
    description: title.description ?? '',
    poster_url: title.poster_url ?? '',
    backdrop_url: title.backdrop_url ?? '',
    video_url: title.video_url ?? '',
    quality: title.quality ?? 'HD',
    category: title.category ?? '',
  })
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(0,0,0,.8)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between" style={{ marginBottom: 18 }}>
          <div className="panel-title" style={{ marginBottom: 0 }}>
            Editar: {title.title}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <XIcon size={18} />
          </button>
        </div>

        {err && <div className="alert alert--error">{err}</div>}

        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setErr(null)
            try {
              await onSave({ ...form, hidden })
            } catch (e2) {
              setErr((e2 as Error).message)
              setBusy(false)
            }
          }}
        >
          {(
            [
              ['title', 'Título'],
              ['category', 'Categoria'],
              ['quality', 'Qualidade'],
              ['poster_url', 'URL da capa'],
              ['backdrop_url', 'URL do banner'],
              ['video_url', 'URL de reprodução (MP4/HLS ou embed autorizado)'],
            ] as const
          ).map(([key, label]) => (
            <div className="field" key={key}>
              <label htmlFor={key}>{label}</label>
              <input
                id={key}
                className="input"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </div>
          ))}

          <div className="field">
            <label htmlFor="description">Sinopse</label>
            <textarea
              id="description"
              className="input"
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <label className="inline" style={{ marginBottom: 18, cursor: 'pointer' }}>
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
            <span style={{ fontSize: '0.88rem' }}>Ocultar do catálogo</span>
          </label>

          <div className="inline">
            <button className="btn btn--primary" type="submit" disabled={busy}>
              <CheckIcon size={17} /> {busy ? 'Salvando…' : 'Salvar'}
            </button>
            <button className="btn btn--outline" type="button" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
