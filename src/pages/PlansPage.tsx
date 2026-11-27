import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchPlans, fetchSubscription, fetchPixConfig, whatsappUrl, WHATSAPP_DISPLAY } from '../lib/access'
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
 * DESCONTOS (definidos pelo proprietário): 1 mês sem desconto, 3 meses com 20%
 * e 1 ano com 50%. O servidor calcula o valor do período e devolve também o
 * valor cheio (`full_label`) e a economia (`saved_label`), que a UI mostra com
 * o preço riscado. O link do WhatsApp já vai com e-mail, plano, duração e valor.
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
  /*
    Período escolhido POR PLANO.

    Antes havia um seletor único acima da grade e um `period` global. O
    proprietário pediu que a escolha de 1 mês / 3 meses / 1 ano ficasse DENTRO
    de cada card, junto do preço que ela muda — e que o seletor solto saísse.
    Um mapa por código de plano mantém cada card independente: trocar o período
    do Básico não mexe no do Premium.
  */
  const [periodByPlan, setPeriodByPlan] = useState<Record<string, PlanPeriod['code']>>({})

  /**
   * O Pix está disponível neste servidor?
   *
   * Depende de `MP_ACCESS_TOKEN` estar configurado no backend. Quando não
   * está, o botão de contratação volta a ser o WhatsApp — é melhor vender
   * pelo caminho que funciona do que mostrar um botão que dá erro.
   */
  const [pixEnabled, setPixEnabled] = useState(false)
  /*
    Cartão habilitado no servidor?

    Depende de DUAS credenciais (MP_ACCESS_TOKEN + MP_PUBLIC_KEY). O texto do
    botão é SEMPRE "Pagar com Pix ou cartão de crédito" — é o rótulo que o
    proprietário pediu, e a escolha entre Pix e cartão acontece na tela de
    pagamento, que já tem o seletor. Quando o cartão está desligado no servidor,
    a tela de pagamento explica o que falta, em vez de esconder a opção sem
    explicação. O estado `cardEnabled` continua sendo lido para esse aviso.
  */
  const [cardEnabled, setCardEnabled] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const data = await fetchPlans(user?.email)
        if (!active) return
        setPlans(data.plans)
        const cfg = await fetchPixConfig()
        if (active) {
          setPixEnabled(cfg.pix_enabled)
          setCardEnabled(Boolean(cfg.card_enabled))
        }
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
        Escolha um plano para assistir. Se ainda não usou, peça seu <strong>mês grátis</strong> pelo
        WhatsApp — o código de 6 dígitos é digitado na aba de contas.
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
            Os planos ainda não foram cadastrados no painel. Fale com a gente pelo WhatsApp para
            contratar ou para pedir seu mês grátis.
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
              const period = periodByPlan[p.code] ?? '1m'
              const chosen = periods.find((x) => x.code === period) ?? periods[0]

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

                  {/*
                    Escolha do período DENTRO do card.

                    Substitui o seletor que ficava solto acima da grade — era ele
                    que aparecia como um retângulo vermelho isolado, sem relação
                    visual com o preço que alterava. Aqui o botão fica ao lado do
                    valor que ele muda.
                  */}
                  <div className="inline" style={{ gap: 6, margin: '10px 0 4px', flexWrap: 'wrap' }}>
                    {PERIOD_ORDER.map((code) => {
                      const label = code === '1m' ? '1 mês' : code === '3m' ? '3 meses' : '1 ano'
                      const isOn = period === code
                      return (
                        <button
                          key={code}
                          className={`btn ${isOn ? 'btn--primary' : 'btn--outline'} btn--sm`}
                          onClick={() => setPeriodByPlan((prev) => ({ ...prev, [p.code]: code }))}
                          aria-pressed={isOn}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>

                  <div style={{ fontSize: '1.9rem', fontWeight: 800, margin: '6px 0 2px' }}>
                    {chosen?.price_label ?? p.price_label}
                    <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                      {' '}
                      /{chosen?.label ?? `${p.duration_days} dias`}
                    </span>
                  </div>

                  {chosen && chosen.saved_cents ? (
                    <p style={{ fontSize: '0.8rem', margin: '0 0 8px' }}>
                      <span
                        className="muted"
                        style={{ textDecoration: 'line-through', marginRight: 8 }}
                      >
                        {chosen.full_label}
                      </span>
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
                        economize {chosen.saved_label}
                      </span>
                    </p>
                  ) : null}

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

                  {/*
                    Contratação.

                    Com o Pix ativo, o botão leva à tela de pagamento — o
                    cliente paga e a conta é liberada sozinha, sem comprovante
                    e sem falar com ninguém. Sem Pix configurado no servidor,
                    cai no WhatsApp, que continua existindo para suporte.
                  */}
                  {pixEnabled ? (
                    <button
                      className="btn btn--primary"
                      onClick={() =>
                        navigate(
                          `/pagamento/pix?plano=${encodeURIComponent(p.code)}&periodo=${encodeURIComponent(period)}`,
                        )
                      }
                    >
                      Pagar com Pix ou cartão de crédito
                    </button>
                  ) : (
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
                  )}
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
