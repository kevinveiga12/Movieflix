import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchPlans, fetchSubscription, whatsappUrl, WHATSAPP_DISPLAY } from '../lib/access'
import type { Plan, PlanPeriod, Subscription } from '../lib/types'
import { CheckIcon, InfoIcon, ArrowLeft } from '../components/Icons'

/**
 * Planos e assinatura.
 *
 * Os preços vêm de /api/plans (tabela `plans` do Supabase) — nada é fixado no
 * código. A tabela mostra os três períodos (1 mês / 3 meses / 1 ano) para cada
 * plano. A contratação é feita pelo WhatsApp, que é o fluxo já configurado no
 * projeto; não há cobrança automática aqui.
 *
 * Quando o período de 3 meses ou 1 ano ainda não tem preço próprio definido, o
 * servidor devolve o mensal multiplicado e marca `price_source: 'derived'`.
 * A UI mostra o valor e sinaliza discretamente que é o mensal x meses, em vez
 * de inventar um desconto.
 */

const PERIOD_ORDER: Array<PlanPeriod['code']> = ['1m', '3m', '12m']

export function PlansPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [plans, setPlans] = useState<Plan[]>([])
  const [sub, setSub] = useState<Subscription | null>(null)
  const [access, setAccess] = useState<{ daysLeft: number | null; trialEndsAt: string | null; reason: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<PlanPeriod['code']>('1m')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const data = await fetchPlans()
        if (!active) return
        setPlans(data.plans)
        if (user) {
          const s = await fetchSubscription()
          if (active) {
            setSub(s.subscription)
            setAccess((s as { access?: typeof access }).access ?? null)
          }
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

  const active = Boolean(
    sub && String(sub.status).toLowerCase() === 'active' && sub.expires_at && new Date(sub.expires_at) > new Date(),
  )

  const trialDays = access?.daysLeft ?? null
  const onTrial = Boolean(user && !active && trialDays !== null && trialDays > 0)

  return (
    <div className="page" style={{ paddingTop: 32, maxWidth: 1080 }}>
      <button className="btn btn--ghost" onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
        <ArrowLeft size={17} /> Voltar
      </button>

      <h1 className="section-title" style={{ fontSize: 'clamp(1.6rem,3vw,2.4rem)', marginBottom: 8 }}>
        Planos
      </h1>
      <p className="muted" style={{ marginBottom: 24, fontSize: '0.95rem' }}>
        Toda conta nova tem <strong>1 mês grátis</strong>. Depois desse período, escolha um plano para
        continuar assistindo.
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

      {onTrial && (
        <div className="alert alert--info" style={{ marginBottom: 20 }}>
          <InfoIcon size={18} />
          <span>
            Você está no <strong>mês grátis</strong> — {trialDays} dia{trialDays === 1 ? '' : 's'} restante
            {trialDays === 1 ? '' : 's'}
            {access?.trialEndsAt && ` (até ${new Date(access.trialEndsAt).toLocaleDateString('pt-BR')})`}.
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
        <div className="panel" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ fontSize: '2.2rem', marginBottom: 10 }}>🎬</div>
          <h3 className="panel-title" style={{ marginBottom: 8 }}>
            Planos em configuração
          </h3>
          <p className="panel-sub" style={{ marginBottom: 20 }}>
            Os planos ainda não foram cadastrados no painel. Enquanto isso, sua conta continua com o
            mês grátis. Fale com a gente pelo WhatsApp para contratar.
          </p>
          <a
            className="btn btn--primary"
            href={whatsappUrl('Olá! Quero saber sobre os planos do MovieFlix.')}
            target="_blank"
            rel="noopener noreferrer"
          >
            Falar no WhatsApp
          </a>
        </div>
      ) : (
        <>
          {/* Seletor de período */}
          <div className="inline" style={{ marginBottom: 18, gap: 8 }}>
            {PERIOD_ORDER.map((code) => {
              const label = code === '1m' ? '1 mês' : code === '3m' ? '3 meses' : '1 ano'
              const isOn = period === code
              return (
                <button
                  key={code}
                  className={`btn ${isOn ? 'btn--primary' : 'btn--outline'} btn--sm`}
                  onClick={() => setPeriod(code)}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
              gap: 18,
            }}
          >
            {plans.map((p) => {
              const isCurrent = active && sub?.plan_code === p.code
              const periods = p.periods ?? []
              const chosen = periods.find((x) => x.code === period) ?? periods[0]
              const derived = chosen?.price_source === 'derived'

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
                    {chosen?.price_label ?? p.price_label}
                    <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                      {' '}
                      /{chosen?.label ?? `${p.duration_days} dias`}
                    </span>
                  </div>

                  {derived && (
                    <p className="muted" style={{ fontSize: '0.76rem', margin: '0 0 8px' }}>
                      Valor do período = mensal × {chosen?.months}. Desconto ainda não definido.
                    </p>
                  )}

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
                    href={
                      chosen?.whatsapp_url ??
                      p.whatsapp_url ??
                      whatsappUrl(`Olá! Quero assinar o MovieFlix — ${p.name}.`)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Assinar pelo WhatsApp
                  </a>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Contato direto */}
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-title">Falar com a gente</div>
        <p className="panel-sub" style={{ marginBottom: 14 }}>
          Dúvidas sobre planos, pagamento ou acesso? Chame no WhatsApp {WHATSAPP_DISPLAY} — respondemos
          por lá.
        </p>
        <a
          className="btn btn--primary"
          href={whatsappUrl('Olá! Preciso de ajuda com o MovieFlix.')}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp {WHATSAPP_DISPLAY}
        </a>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title">Como funciona</div>
        <p className="panel-sub" style={{ marginBottom: 10 }}>
          Crie sua conta e assista por 1 mês sem pagar nada. Ao final do período gratuito, o acesso é
          pausado até a contratação de um plano. Sua conta guarda favoritos, histórico e o ponto onde
          você parou em todos os dispositivos.
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
