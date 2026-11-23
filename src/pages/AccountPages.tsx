import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useFavorites, useHistory, parseEpisodeId } from '../lib/userData'
import { loadCatalog, getById } from '../lib/catalog'
import { redeemTrialCode, trialRequestMessage, whatsappUrl, fetchSubscription } from '../lib/access'
import { PosterCard } from '../components/PosterCard'
import { HeartIcon, ClockIcon, LogoutIcon, SettingsIcon, UserIcon, PlayIcon } from '../components/Icons'

/** "1h 12min" / "12min" / "40s" — tempo assistido legível. */
function formatWatched(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min`
  return `${Math.floor(m / 60)}h ${m % 60}min`
}

/**
 * SEÇÃO "1 MÊS GRÁTIS"
 *
 * O mês grátis deixou de ser automático: ninguém recebe 30 dias ao criar a
 * conta. Quem libera é o administrador, por um código de 6 dígitos.
 *
 * Aqui ficam as duas coisas lado a lado, como pedido:
 *   1. o botão que abre o WhatsApp do administrador com a mensagem pronta
 *      (o e-mail vem da conta autenticada, não de um campo editável);
 *   2. o campo para digitar o código e confirmar.
 *
 * A validação acontece no servidor (`POST /api/trial/redeem`) — este
 * componente só mostra o resultado.
 */
function TrialSection({ email, name }: { email: string | null | undefined; name?: string | null }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<{ daysLeft: number | null; reason: string; trialEndsAt: string | null } | null>(
    null,
  )

  useEffect(() => {
    let alive = true
    fetchSubscription()
      .then((r) => {
        if (alive) setStatus(r.access as typeof status)
      })
      .catch(() => {
        /* sem sessão ou API fora: a seção continua utilizável */
      })
    return () => {
      alive = false
    }
  }, [])

  const onTrial = Boolean(status && status.daysLeft !== null && status.daysLeft > 0 && status.reason === 'trial')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setOk(null)
    const clean = code.replace(/\D/g, '')
    if (clean.length !== 6) {
      setErr('Digite os 6 números do código.')
      return
    }
    setBusy(true)
    const r = await redeemTrialCode(clean)
    setBusy(false)
    if (r.ok) {
      setOk(
        r.endsAt
          ? `Pronto! Seu mês grátis está liberado até ${new Date(r.endsAt).toLocaleDateString('pt-BR')}.`
          : (r.message ?? 'Mês grátis liberado.'),
      )
      setCode('')
      const fresh = await fetchSubscription().catch(() => null)
      if (fresh) setStatus(fresh.access as typeof status)
      return
    }
    const extra =
      typeof r.attemptsLeft === 'number' && r.attemptsLeft > 0 && r.attemptsLeft < 5
        ? ` Tentativas restantes: ${r.attemptsLeft}.`
        : ''
    setErr((r.error ?? 'Não foi possível validar o código.') + extra)
  }

  return (
    <div className="panel">
      <div className="panel-title">1 mês grátis</div>
      <p className="panel-sub">
        Peça o código de 6 dígitos pelo WhatsApp e digite aqui para liberar seus 30 dias gratuitos.
      </p>

      {onTrial && (
        <div className="alert alert--success" style={{ marginBottom: 14 }}>
          Você já está no mês grátis — {status?.daysLeft} dia{status?.daysLeft === 1 ? '' : 's'} restante
          {status?.daysLeft === 1 ? '' : 's'}
          {status?.trialEndsAt && ` (até ${new Date(status.trialEndsAt).toLocaleDateString('pt-BR')})`}.
        </div>
      )}
      {ok && (
        <div className="alert alert--success" style={{ marginBottom: 14 }}>
          {ok}
        </div>
      )}
      {err && (
        <div className="alert alert--error" style={{ marginBottom: 14 }}>
          {err}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <a
          className="btn btn--primary"
          href={whatsappUrl(trialRequestMessage(email, name))}
          target="_blank"
          rel="noopener noreferrer"
          style={{ height: 44, whiteSpace: 'nowrap' }}
        >
          Pedir código no WhatsApp
        </a>

        <form
          onSubmit={submit}
          style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <div className="field" style={{ margin: 0, width: 132, flex: '0 0 auto' }}>
            <label htmlFor="trial-code" className="sr-only">
              Código de 6 dígitos
            </label>
            <input
              id="trial-code"
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="Código"
              aria-label="Código de 6 dígitos"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ height: 44, width: 132, letterSpacing: '0.12em', textAlign: 'center' }}
            />
          </div>
          <button
            className="btn btn--outline"
            type="submit"
            disabled={busy || code.length !== 6}
            style={{ height: 44, whiteSpace: 'nowrap' }}
          >
            {busy ? 'Validando…' : 'Confirmar código'}
          </button>
        </form>
      </div>

      <p className="muted" style={{ fontSize: '0.78rem', marginTop: 12 }}>
        O código vale 7 dias, é de uso único e só funciona na conta para a qual foi gerado.
      </p>
    </div>
  )
}

export function FavoritesPage() {
  const { user } = useAuth()
  const { favorites, loading } = useFavorites()
  const { progressFor } = useHistory()
  const [ready, setReady] = useState(false)

  /** Barrinha nos cards de favoritos; null quando a duração é desconhecida. */
  const progressOf = (tmdbId: string | number): number | null => {
    const h = progressFor(tmdbId)
    if (!h || !h.duration_seconds) return null
    const pct = h.position_seconds / h.duration_seconds
    return pct > 0.01 && pct < 0.98 ? pct : null
  }

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
            <PosterCard key={`${t!.type}-${t!.tmdb_id}`} title={t!} progress={progressOf(t!.tmdb_id)} />
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

  /**
   * Só mostra o que ainda existe no catálogo verificado.
   *
   * O histórico vem do Supabase e pode ter linhas de títulos que o provedor não
   * serve mais (ou que nunca serviram). Mostrar o card levaria o cliente a um
   * player que não abre; escondemos o card sem apagar nada do banco.
   */
  const visible = ready
    ? history.filter((h) => Boolean(getById(String(h.tmdb_id), h.media_type)))
    : history

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
          {visible.length} registro(s)
        </span>
      </div>

      {loading || !ready ? (
        <div className="grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : visible.length === 0 ? (
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
          {visible.map((h) => {
            const t = getById(String(h.tmdb_id), h.media_type)
            const ep = parseEpisodeId(h.episode_id)
            /**
             * Porcentagem só quando a duração é conhecida.
             *
             * No modo embed o provedor não expõe a duração do vídeo, então
             * `duration_seconds` fica 0 e não há como calcular uma porcentagem
             * honesta. Nesse caso mostramos o tempo assistido, não uma barra
             * inventada.
             */
            const known = h.duration_seconds > 0
            const pct = known ? Math.min(100, (h.position_seconds / h.duration_seconds) * 100) : 0
            const watched = formatWatched(h.position_seconds)
            const base = `/assistir/${h.tmdb_id}?type=${h.media_type}${
              ep ? `&season=${ep.season}&episode=${ep.episode}` : ''
            }`
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
                    {known ? `${Math.round(pct)}% assistido` : `${watched} assistidos`}
                  </div>
                  <div className="progress-track" style={{ height: 3, marginTop: 8, maxWidth: 260 }}>
                    <div className="progress-fill" style={{ width: `${known ? pct : 0}%` }} />
                  </div>
                </div>
                <div className="inline" style={{ flexWrap: 'wrap' }}>
                  {t && (
                    <>
                      <Link to={base} className="btn btn--primary btn--sm">
                        <PlayIcon size={15} /> Continuar de onde parou
                      </Link>
                      <Link to={`${base}&from=start`} className="btn btn--outline btn--sm">
                        Assistir do início
                      </Link>
                    </>
                  )}
                  <button
                    className="btn btn--ghost btn--sm"
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
                <span className="badge badge--purple">Conta ativa</span>
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

      <TrialSection email={user.email} name={profile?.name} />

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
