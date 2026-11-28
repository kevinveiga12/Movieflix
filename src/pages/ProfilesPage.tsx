import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  useProfiles,
  createProfile,
  setActiveProfile,
  deleteProfile,
  PLAN_LABELS,
  type ProfileKind,
} from '../lib/profiles'

/**
 * Tela de perfis da conta.
 *
 * ── O QUE ELA FAZ ───────────────────────────────────────────────────────────
 * Lista os perfis, deixa escolher o ativo, criar e remover. O botão de criar
 * fica BLOQUEADO quando o plano já está no limite, com a frase exata do
 * servidor ("O plano Médio permite 2 perfis e você já tem 2.") — o cliente
 * entende o motivo sem precisar clicar e receber um erro.
 *
 * ── O QUE ELA NÃO FAZ ───────────────────────────────────────────────────────
 * Não decide nada: quem recusa a criação acima do limite é o servidor. Aqui só
 * espelhamos a regra para a tela não oferecer o que vai falhar.
 */

const KIND_LABEL: Record<ProfileKind, string> = {
  adult: 'Perfil normal',
  kids: 'Perfil infantil',
}

export default function ProfilesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { profiles, activeProfileId, summary, loading, error, reload } = useProfiles()

  const [name, setName] = useState('')
  const [kind, setKind] = useState<ProfileKind>('adult')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!user) {
    return (
      <div className="page" style={{ paddingTop: 48, maxWidth: 520 }}>
        <div className="panel" style={{ textAlign: 'center' }}>
          <h3>Você não está logado</h3>
          <p>Entre para gerenciar os perfis da sua conta.</p>
          <Link to="/login" className="btn btn--primary">
            Entrar
          </Link>
        </div>
      </div>
    )
  }

  const limits = summary?.limits ?? { adult: 1, kids: 0 }
  const used = summary?.used ?? { adult: 0, kids: 0, total: 0 }
  const planLabel = summary?.planLabel ?? (summary?.plan ? PLAN_LABELS[summary.plan] : null)

  const adultFull = used.adult >= limits.adult
  const kidsFull = used.kids >= limits.kids
  const kidsAvailable = limits.kids > 0

  // O tipo escolhido no formulário está no limite? Então o botão fica travado.
  const selectedFull = kind === 'kids' ? kidsFull : adultFull
  const selectedReason =
    kind === 'kids' ? summary?.canCreateKids?.reason : summary?.canCreateAdult?.reason

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setNotice(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('Informe o nome do perfil.')
      return
    }
    setBusy(true)
    try {
      await createProfile(trimmed, kind)
      setName('')
      setNotice(`Perfil "${trimmed}" criado.`)
      await reload()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível criar o perfil.')
    } finally {
      setBusy(false)
    }
  }

  async function handleActivate(id: string) {
    setBusy(true)
    setFormError(null)
    try {
      await setActiveProfile(id)
      await reload()
      setNotice('Perfil ativo alterado.')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível trocar o perfil.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string, profileName: string) {
    if (!window.confirm(`Remover o perfil "${profileName}"? Favoritos e histórico da conta continuam salvos.`)) {
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      await deleteProfile(id)
      await reload()
      setNotice(`Perfil "${profileName}" removido.`)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível remover o perfil.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page" style={{ paddingTop: 32, maxWidth: 820 }}>
      <div className="row-between" style={{ marginBottom: 20 }}>
        <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.2rem)', margin: 0 }}>
          Perfis
        </h1>
        <Link to="/perfil" className="btn btn--outline btn--sm">
          Minha conta
        </Link>
      </div>

      {error && <div className="alert alert--error">{error}</div>}
      {formError && <div className="alert alert--error">{formError}</div>}
      {notice && <div className="alert alert--success">{notice}</div>}

      <div className="panel">
        <div className="row-between">
          <div>
            <div className="panel-title">Seu plano</div>
            <p className="panel-sub" style={{ marginBottom: 0 }}>
              {planLabel ? `Plano ${planLabel}` : 'Sem plano ativo'} — {limits.adult}{' '}
              {limits.adult === 1 ? 'perfil' : 'perfis'}
              {kidsAvailable ? ` + ${limits.kids} infantil` : ' (sem perfil infantil)'}
            </p>
          </div>
          <Link to="/planos" className="btn btn--outline btn--sm">
            Ver planos
          </Link>
        </div>
        <div className="inline" style={{ gap: 24, marginTop: 16 }}>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>
              {used.adult}/{limits.adult}
            </div>
            <div className="muted" style={{ fontSize: '0.82rem' }}>
              Perfis normais
            </div>
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>
              {used.kids}/{limits.kids}
            </div>
            <div className="muted" style={{ fontSize: '0.82rem' }}>
              Perfis infantis
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Perfis da conta</div>
        <p className="panel-sub">Escolha quem está assistindo. O perfil infantil só vê conteúdo infantil.</p>

        {loading && <p className="muted">Carregando perfis…</p>}

        {!loading && profiles.length === 0 && (
          <p className="muted">Nenhum perfil ainda. Crie o primeiro abaixo.</p>
        )}

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {profiles.map((p) => {
            const isActive = p.id === activeProfileId
            return (
              <div
                key={p.id}
                className="row-between"
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: isActive ? '1px solid var(--accent, #7c5cff)' : '1px solid rgba(255,255,255,0.08)',
                  background: isActive ? 'rgba(124,92,255,0.10)' : 'transparent',
                }}
              >
                <div className="inline" style={{ gap: 12 }}>
                  <div className="avatar-lg" style={{ width: 40, height: 40, fontSize: '1rem' }}>
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div className="muted" style={{ fontSize: '0.82rem' }}>
                      {KIND_LABEL[p.kind]}
                      {isActive ? ' · em uso' : ''}
                    </div>
                  </div>
                </div>
                <div className="inline" style={{ gap: 8 }}>
                  {!isActive && (
                    <button
                      className="btn btn--outline btn--sm"
                      disabled={busy}
                      onClick={() => handleActivate(p.id)}
                    >
                      Usar
                    </button>
                  )}
                  {profiles.length > 1 && (
                    <button
                      className="btn btn--outline btn--sm"
                      disabled={busy}
                      onClick={() => handleDelete(p.id, p.name)}
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Criar perfil</div>
        <p className="panel-sub">
          {adultFull && kidsFull
            ? 'Você atingiu o limite de perfis do seu plano.'
            : 'Escolha o tipo e dê um nome ao perfil.'}
        </p>

        <form onSubmit={handleCreate}>
          <div className="field">
            <label htmlFor="profile-name">Nome do perfil</label>
            <input
              id="profile-name"
              className="input"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Ana, Sala, Crianças"
              disabled={busy}
            />
          </div>

          <div className="field">
            <label>Tipo de perfil</label>
            <div className="inline" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn btn--sm ${kind === 'adult' ? 'btn--primary' : 'btn--outline'}`}
                onClick={() => setKind('adult')}
                disabled={busy}
              >
                Perfil normal ({used.adult}/{limits.adult})
              </button>
              <button
                type="button"
                className={`btn btn--sm ${kind === 'kids' ? 'btn--primary' : 'btn--outline'}`}
                onClick={() => setKind('kids')}
                disabled={busy || !kidsAvailable}
                title={!kidsAvailable ? 'Seu plano não inclui perfil infantil.' : undefined}
              >
                Perfil infantil ({used.kids}/{limits.kids})
              </button>
            </div>
            {!kidsAvailable && (
              <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8 }}>
                O plano {planLabel ?? 'atual'} não inclui perfil infantil. Faça upgrade para o Médio ou Premium.
              </p>
            )}
          </div>

          {selectedFull && selectedReason && (
            <div className="alert alert--error" style={{ marginBottom: 12 }}>
              {selectedReason}
            </div>
          )}

          <button className="btn btn--primary" type="submit" disabled={busy || selectedFull}>
            {busy ? 'Criando…' : selectedFull ? 'Limite do plano atingido' : 'Criar perfil'}
          </button>
        </form>
      </div>
    </div>
  )
}
