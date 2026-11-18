import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { loadCatalog, getAll } from '../lib/catalog'
import { CheckIcon, XIcon, SearchIcon, SettingsIcon, UserIcon, FilmIcon } from '../components/Icons'
import type { Title } from '../lib/types'

type Tab = 'overview' | 'catalog' | 'users' | 'plans'

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
  name: string | null
  is_admin: boolean
  created_at: string
}

/** Linha de plano editável no painel. */
interface PlanRow {
  code: string
  name: string
  price_cents: number
  discount_3m: number
  discount_12m: number
  is_active: boolean
}

/** Configuração vinda de /api/admin/plans (só o que o painel alterou). */
type PlanConfig = Record<
  string,
  { price_cents?: number; discount_3m?: number; discount_12m?: number; is_active?: boolean }
>

/**
 * Configuração canônica — precisa refletir DEFAULT_PLANS de
 * server/routes/plans.js. Serve só como valor inicial do formulário; o que vale
 * é o que o servidor devolve em /api/plans depois de salvar.
 */
const PLAN_DEFAULTS: PlanRow[] = [
  { code: 'basico', name: 'Básico', price_cents: 1990, discount_3m: 0.2, discount_12m: 0.5, is_active: true },
  { code: 'standard', name: 'Médio', price_cents: 2990, discount_3m: 0.2, discount_12m: 0.5, is_active: true },
  { code: 'premium', name: 'Premium', price_cents: 3990, discount_3m: 0.2, discount_12m: 0.5, is_active: true },
]

const PERIODS = [
  { code: '1m', label: '1 mês', days: 30 },
  { code: '3m', label: '3 meses', days: 90 },
  { code: '12m', label: '1 ano', days: 365 },
] as const

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`

export function AdminPage() {
  const { user, profile, loading, session } = useAuth()
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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

  async function loadAll() {
    try {
      const s = await api('/stats')
      setStats(s)
      const u = await api('/users?limit=100')
      setUsers(u.users ?? [])
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    if (!token || !profile?.is_admin) return
    void loadAll()
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
      {notice && (
        <div className="alert alert--success">
          <CheckIcon size={17} />
          <span>{notice}</span>
        </div>
      )}

      <div className="filters">
        {(
          [
            ['overview', 'Visão geral'],
            ['catalog', 'Catálogo'],
            ['users', 'Usuários'],
            ['plans', 'Planos'],
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
        <UsersTab
          users={users}
          api={api}
          onChanged={async (msg) => {
            setNotice(msg)
            await loadAll()
          }}
          onError={(m) => setError(m)}
          selfId={user.id}
        />
      )}

      {tab === 'plans' && (
        <PlansTab
          api={api}
          onSaved={(msg) => setNotice(msg)}
          onError={(m) => setError(m)}
        />
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

/* ──────────────────────────────────────────────────────────────────────────
 * ABA PLANOS — preço mensal, descontos de 3 meses / 1 ano, ativar-desativar
 * ────────────────────────────────────────────────────────────────────────── */

function PlansTab({
  api,
  onSaved,
  onError,
}: {
  api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>
  onSaved: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [rows, setRows] = useState<PlanRow[]>(PLAN_DEFAULTS)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = (await api('/plans')) as { plans?: PlanConfig }
        if (!alive) return
        const cfg = data.plans ?? {}
        setRows(
          PLAN_DEFAULTS.map((d) => {
            const o = cfg[d.code] ?? {}
            return {
              ...d,
              price_cents: o.price_cents ?? d.price_cents,
              discount_3m: o.discount_3m ?? d.discount_3m,
              discount_12m: o.discount_12m ?? d.discount_12m,
              is_active: o.is_active ?? d.is_active,
            }
          }),
        )
      } catch (e) {
        if (alive) onError((e as Error).message)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(row: PlanRow) {
    setBusy(row.code)
    try {
      await api(`/plans/${row.code}`, {
        method: 'PUT',
        body: JSON.stringify({
          price_cents: row.price_cents,
          discount_3m: row.discount_3m,
          discount_12m: row.discount_12m,
          is_active: row.is_active,
        }),
      })
      onSaved(`Plano ${row.name} salvo. A página de planos já mostra o valor novo.`)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function patch(code: string, p: Partial<PlanRow>) {
    setRows((rs) => rs.map((r) => (r.code === code ? { ...r, ...p } : r)))
  }

  return (
    <>
      <div className="panel">
        <div className="panel-title">Preços e descontos</div>
        <p className="panel-sub">
          O valor do período é calculado como <strong>mensal × meses × (1 − desconto)</strong>. O
          desconto é aplicado sobre o valor cheio — o site mostra o preço riscado e a economia.
        </p>

        <div className="episode-list">
          {rows.map((r) => {
            const full3 = r.price_cents * 3
            const full12 = r.price_cents * 12
            const p3 = Math.round(full3 * (1 - r.discount_3m))
            const p12 = Math.round(full12 * (1 - r.discount_12m))
            return (
              <div key={r.code} className="episode" style={{ cursor: 'default', flexWrap: 'wrap', gap: 12 }}>
                <div className="episode-info" style={{ minWidth: 130 }}>
                  <div className="episode-title">{r.name}</div>
                  <div className="episode-sub">{r.code}</div>
                </div>

                <div className="field" style={{ margin: 0, minWidth: 130 }}>
                  <label htmlFor={`price-${r.code}`}>Mensal (R$)</label>
                  <input
                    id={`price-${r.code}`}
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={(r.price_cents / 100).toFixed(2)}
                    onChange={(e) =>
                      patch(r.code, { price_cents: Math.round(Number(e.target.value) * 100) || 0 })
                    }
                  />
                </div>

                <div className="field" style={{ margin: 0, minWidth: 110 }}>
                  <label htmlFor={`d3-${r.code}`}>Desconto 3m (%)</label>
                  <input
                    id={`d3-${r.code}`}
                    className="input"
                    type="number"
                    step="1"
                    min="0"
                    max="90"
                    value={Math.round(r.discount_3m * 100)}
                    onChange={(e) => patch(r.code, { discount_3m: Number(e.target.value) / 100 || 0 })}
                  />
                </div>

                <div className="field" style={{ margin: 0, minWidth: 110 }}>
                  <label htmlFor={`d12-${r.code}`}>Desconto 1 ano (%)</label>
                  <input
                    id={`d12-${r.code}`}
                    className="input"
                    type="number"
                    step="1"
                    min="0"
                    max="90"
                    value={Math.round(r.discount_12m * 100)}
                    onChange={(e) => patch(r.code, { discount_12m: Number(e.target.value) / 100 || 0 })}
                  />
                </div>

                <div style={{ minWidth: 190, fontSize: '0.82rem' }} className="muted">
                  <div>1 mês: {brl(r.price_cents)}</div>
                  <div>
                    3 meses: <s>{brl(full3)}</s> {brl(p3)}
                  </div>
                  <div>
                    1 ano: <s>{brl(full12)}</s> {brl(p12)}
                  </div>
                </div>

                <label className="inline" style={{ cursor: 'pointer', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={r.is_active}
                    onChange={(e) => patch(r.code, { is_active: e.target.checked })}
                  />
                  <span style={{ fontSize: '0.85rem' }}>{r.is_active ? 'Ativo' : 'Inativo'}</span>
                </label>

                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => void save(r)}
                  disabled={busy === r.code}
                >
                  <CheckIcon size={15} /> {busy === r.code ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * ABA USUÁRIOS — ativar/desativar acesso, conceder plano e ver validade
 * ────────────────────────────────────────────────────────────────────────── */

function UsersTab({
  users,
  api,
  onChanged,
  onError,
  selfId,
}: {
  users: AdminUser[]
  api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>
  onChanged: (msg: string) => Promise<void>
  onError: (msg: string) => void
  selfId: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Situação de acesso carregada por usuário (app_metadata).
  const [access, setAccess] = useState<
    Record<string, { disabled: boolean; plan_code: string | null; plan_expires_at: string | null }>
  >({})
  const [plan, setPlan] = useState<Record<string, string>>({})
  const [period, setPeriod] = useState<Record<string, string>>({})

  async function loadAccess(id: string) {
    try {
      const a = (await api(`/users/${id}/access`)) as {
        disabled: boolean
        plan_code: string | null
        plan_expires_at: string | null
      }
      setAccess((m) => ({ ...m, [id]: a }))
    } catch (e) {
      onError((e as Error).message)
    }
  }

  async function toggle(id: string, disabled: boolean) {
    setBusy(id)
    try {
      await api(`/users/${id}/access`, {
        method: 'PUT',
        body: JSON.stringify({ disabled }),
      })
      await loadAccess(id)
      await onChanged(disabled ? 'Acesso desativado.' : 'Acesso reativado.')
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function grant(id: string) {
    const planCode = plan[id] ?? 'basico'
    const per = period[id] ?? '1m'
    setBusy(id)
    try {
      const r = (await api(`/users/${id}/plan`, {
        method: 'POST',
        body: JSON.stringify({ plan_code: planCode, period: per }),
      })) as { plan_expires_at?: string }
      await loadAccess(id)
      await onChanged(
        `Plano concedido até ${r.plan_expires_at ? new Date(r.plan_expires_at).toLocaleDateString('pt-BR') : '—'}.`,
      )
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-title">Usuários</div>
        <p className="panel-sub">
          Desativar bloqueia a reprodução na hora (inclusive com plano vigente). Conceder plano
          grava a validade em <code>app_metadata</code> — a mesma fonte que o servidor confia.
        </p>

        {users.length === 0 && <p className="muted">Nenhum usuário carregado.</p>}

        <div className="episode-list">
          {users.map((u) => {
            const a = access[u.id]
            const isOpen = openId === u.id
            return (
              <div key={u.id} className="episode" style={{ cursor: 'default', flexWrap: 'wrap', gap: 10 }}>
                <div className="episode-num" style={{ background: 'rgba(139,92,246,.14)', color: '#c4b5fd' }}>
                  {(u.name || u.email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="episode-info" style={{ minWidth: 200 }}>
                  <div className="episode-title">
                    {u.name || 'Sem nome'}
                    {u.is_admin && (
                      <span className="badge badge--red" style={{ marginLeft: 8 }}>
                        Admin
                      </span>
                    )}
                    {a?.disabled && (
                      <span className="badge" style={{ marginLeft: 8, background: 'rgba(239,68,68,.2)', color: '#fca5a5' }}>
                        Desativado
                      </span>
                    )}
                  </div>
                  <div className="episode-sub">
                    {u.email} · desde {new Date(u.created_at).toLocaleDateString('pt-BR')}
                  </div>
                  {a?.plan_code && (
                    <div className="episode-sub" style={{ color: 'var(--accent)' }}>
                      Plano {a.plan_code} até{' '}
                      {a.plan_expires_at
                        ? new Date(a.plan_expires_at).toLocaleDateString('pt-BR')
                        : '—'}
                    </div>
                  )}
                </div>

                <button
                  className="btn btn--ghost btn--sm"
                  onClick={async () => {
                    if (isOpen) {
                      setOpenId(null)
                    } else {
                      setOpenId(u.id)
                      if (!access[u.id]) await loadAccess(u.id)
                    }
                  }}
                >
                  <SettingsIcon size={15} /> Gerenciar
                </button>

                {u.id !== selfId && (
                  <button
                    className={`btn btn--sm ${a?.disabled ? 'btn--primary' : 'btn--outline'}`}
                    onClick={() => void toggle(u.id, !a?.disabled)}
                    disabled={busy === u.id}
                  >
                    {a?.disabled ? 'Reativar' : 'Desativar'}
                  </button>
                )}

                {isOpen && (
                  <div
                    style={{
                      flexBasis: '100%',
                      borderTop: '1px solid rgba(255,255,255,.08)',
                      paddingTop: 12,
                      marginTop: 4,
                      display: 'flex',
                      gap: 10,
                      flexWrap: 'wrap',
                      alignItems: 'flex-end',
                    }}
                  >
                    <div className="field" style={{ margin: 0, minWidth: 130 }}>
                      <label htmlFor={`plan-${u.id}`}>Plano</label>
                      <select
                        id={`plan-${u.id}`}
                        className="input"
                        value={plan[u.id] ?? 'basico'}
                        onChange={(e) => setPlan((m) => ({ ...m, [u.id]: e.target.value }))}
                      >
                        <option value="basico">Básico</option>
                        <option value="standard">Médio</option>
                        <option value="premium">Premium</option>
                      </select>
                    </div>

                    <div className="field" style={{ margin: 0, minWidth: 120 }}>
                      <label htmlFor={`per-${u.id}`}>Duração</label>
                      <select
                        id={`per-${u.id}`}
                        className="input"
                        value={period[u.id] ?? '1m'}
                        onChange={(e) => setPeriod((m) => ({ ...m, [u.id]: e.target.value }))}
                      >
                        {PERIODS.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      className="btn btn--primary btn--sm"
                      onClick={() => void grant(u.id)}
                      disabled={busy === u.id}
                    >
                      <CheckIcon size={15} /> Conceder plano
                    </button>

                    <span className="muted" style={{ fontSize: '0.78rem', flexBasis: '100%' }}>
                      A validade é somada ao fim do plano atual, se ainda estiver vigente — assim
                      ninguém perde dias já pagos.
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
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
