import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchPlans, fetchSubscription, whatsappUrl, WHATSAPP_DISPLAY } from '../lib/access'
import type { Plan, Subscription } from '../lib/types'
import { CheckIcon, InfoIcon, ArrowLeft } from '../components/Icons'

/**
 * Planos e assinatura.
 *
 * Os preços e benefícios vêm de /api/plans (tabela `plans` do Supabase) — nada
 * é fixado no código. A contratação é feita pelo WhatsApp, que é o fluxo já
 * configurado no projeto; não há cobrança automática aqui.
 */

export function PlansPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [plans, setPlans] = useState<Plan[]>([])
  const [sub, setSub] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const data = await fetchPlans()
        if (!active) return
        setPlans(data.plans)
        if (user) {
          const s = await fetchSubscription()
          if (active) setSub(s.subscription)
        }
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  const active = Boolean(sub && String(sub.status).toLowerCase() === 'active' && sub.expires_at && new Date(sub.expires_at) > new Date())

  return (
    <div className="page" style={{ paddingTop: 32, maxWidth: 1080 }}>
      <button className="btn btn--ghost" onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
        <ArrowLeft size={17} /> Voltar
      </button>

      <h1 className="section-title" style={{ fontSize: 'clamp(1.6rem,3vw,2.4rem)', marginBottom: 8 }}>
        Escolha seu plano
      </h1>
      <p className="muted" style={{ marginBottom: 24, fontSize: '0.95rem' }}>
        Navegar pelo catálogo é livre. Para assistir, é preciso ter uma conta com plano ativo.
      </p>

      {active && sub && (
        <div className="alert alert--success" style={{ marginBottom: 20 }}>
          <CheckIcon size={18} />
          <span>
            Plano ativo: <strong>{sub.plan_label ?? sub.plan_code}</strong>
            {sub.expires_at && ` · válido até ${new Date(sub.expires_at).toLocaleDateString('pt-BR')}`}
          </span>
        </div>
      )}

      {error && (
        <div className="alert alert--error" style={{ marginBottom: 20 }}>
          <InfoIcon size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : plans.length === 0 ? (
        <div className="empty">
          <h3>Planos indisponíveis</h3>
          <p>Não foi possível carregar os planos agora. Tente novamente em instantes.</p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
            gap: 18,
          }}
        >
          {plans.map((p) => {
            const isCurrent = active && sub?.plan_code === p.code
            return (
              <div
                key={p.id}
                className="panel"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  border: isCurrent ? '1px solid var(--accent)' : undefined,
                }}
              >
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <div className="panel-title" style={{ marginBottom: 0 }}>
                    {p.name}
                  </div>
                  {isCurrent && <span className="badge badge--purple">Seu plano</span>}
                </div>
                <div style={{ fontSize: '1.9rem', fontWeight: 800, margin: '6px 0 2px' }}>
                  {p.price_label}
                  <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                    {' '}
                    /{p.duration_days} dias
                  </span>
                </div>
                {p.description && (
                  <p className="muted" style={{ fontSize: '0.88rem', marginBottom: 12 }}>
                    {p.description}
                  </p>
                )}
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', flex: 1 }}>
                  {(p.features ?? []).map((f) => (
                    <li
                      key={f}
                      style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', fontSize: '0.9rem' }}
                    >
                      <CheckIcon size={15} /> {f}
                    </li>
                  ))}
                </ul>
                <a
                  className="btn btn--primary"
                  href={p.whatsapp_url ?? whatsappUrl(`Olá! Quero assinar o MovieFlix — ${p.name}.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Assinar pelo WhatsApp
                </a>
              </div>
            )
          })}
        </div>
      )}

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-title">Como funciona a ativação</div>
        <p className="panel-sub" style={{ marginBottom: 10 }}>
          A contratação é feita pelo WhatsApp <strong>{WHATSAPP_DISPLAY}</strong>. Depois da confirmação, o
          plano é registrado na sua conta e liberado automaticamente em todos os dispositivos — site, app
          mobile e TV usam a mesma assinatura.
        </p>
        {!user && (
          <div className="inline">
            <Link to="/cadastro" className="btn btn--outline">
              Criar conta
            </Link>
            <Link to="/login" className="btn btn--ghost">
              Já tenho conta
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
