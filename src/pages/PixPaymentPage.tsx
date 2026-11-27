import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { createPixCharge, fetchPaymentStatus, fetchPixConfig, whatsappUrl } from '../lib/access'
import type { PixCharge } from '../lib/types'
import { CardPaymentForm } from '../components/CardPaymentForm'
import { CheckIcon, InfoIcon, ArrowLeft } from '../components/Icons'

/**
 * Pagamento por Pix.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTA TELA FAZ
 * ═══════════════════════════════════════════════════════════════════════════
 * Pede a cobrança ao servidor, mostra o QR e o copia e cola, e acompanha o
 * status em polling até aprovar ou expirar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ELA NÃO FAZ — E POR QUE ISSO IMPORTA
 * ═══════════════════════════════════════════════════════════════════════════
 * Ela NÃO libera acesso. Não existe botão "já paguei" que ative nada, e abrir
 * esta página não ativa nada. Quem ativa é o servidor, depois de consultar a
 * API oficial do Mercado Pago e ver `status: approved`.
 *
 * O polling chama `GET /api/payments/:id/status`, que no servidor também
 * reconcilia: se o webhook se perdeu, é esta consulta que salva o pagamento.
 * Mas ela só ativa com confirmação oficial — nunca porque o cliente disse.
 */

const POLL_MS = 4000
/** Para de consultar depois disso: o Pix expira em 30 min, damos folga. */
const MAX_POLL_MS = 35 * 60_000

export function PixPaymentPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const planCode = params.get('plano') ?? ''
  const period = params.get('periodo') ?? '1m'

  const [charge, setCharge] = useState<PixCharge | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  /*
    Meio de pagamento escolhido. O padrão é Pix porque é o que já existia e o
    que não exige digitar nada — na dúvida, o caminho mais curto.
  */
  const [method, setMethod] = useState<'pix' | 'card'>('pix')
  const [cardEnabled, setCardEnabled] = useState(false)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [cardApproved, setCardApproved] = useState(false)

  /* ── Descobre quais meios existem neste servidor ──────────────────────── */
  useEffect(() => {
    let active = true
    ;(async () => {
      const cfg = await fetchPixConfig()
      if (!active) return
      setCardEnabled(Boolean(cfg.card_enabled))
      setPublicKey(cfg.public_key ?? null)
    })()
    return () => {
      active = false
    }
  }, [])

  /**
   * Gera o Pix direto, sem pedir CPF.
   *
   * O CPF usado na cobrança é o fixo do dono da conta, preenchido no servidor
   * em `payer.identification`. O cliente não digita nada: ao abrir esta tela
   * com um plano escolhido, a cobrança é criada na hora.
   */
  const startedAt = useRef(Date.now())
  const pollTimer = useRef<number | null>(null)

  /* ── Cria a cobrança assim que a tela abre ─────────────────────────────── */
  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (!planCode) {
      setError('Plano não informado.')
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    ;(async () => {
      try {
        const c = await createPixCharge({ planCode, period })
        if (active) setCharge(c)
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [user, planCode, period, navigate])

  /* ── Polling do status ───────────────────────────────────────────────── */
  const poll = useCallback(async () => {
    if (!charge?.payment_id) return
    try {
      const s = await fetchPaymentStatus(charge.payment_id)
      setCharge((prev) => (prev ? { ...prev, ...s } : s))
      // Aprovado ou expirado: para de consultar.
      if (s.approved || s.status === 'expired' || s.status === 'cancelled' || s.status === 'rejected') {
        if (pollTimer.current) window.clearTimeout(pollTimer.current)
        pollTimer.current = null
      }
    } catch {
      // Falha de rede no polling não é erro para o cliente: tenta de novo.
    }
  }, [charge?.payment_id])

  useEffect(() => {
    if (!charge?.payment_id) return
    if (charge.approved) return

    const tick = () => {
      if (Date.now() - startedAt.current > MAX_POLL_MS) return
      void poll()
      pollTimer.current = window.setTimeout(tick, POLL_MS)
    }
    pollTimer.current = window.setTimeout(tick, POLL_MS)

    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
    }
  }, [charge?.payment_id, charge?.approved, poll])

  /* ── Contagem regressiva ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!charge?.expires_at) return
    const end = new Date(charge.expires_at).getTime()
    if (!Number.isFinite(end)) return

    const update = () => {
      const left = Math.max(0, Math.floor((end - Date.now()) / 1000))
      setSecondsLeft(left)
    }
    update()
    const id = window.setInterval(update, 1000)
    return () => window.clearInterval(id)
  }, [charge?.expires_at])

  async function copyCode() {
    if (!charge?.qr_code) return
    try {
      await navigator.clipboard.writeText(charge.qr_code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      // Navegador sem permissão de clipboard: seleciona o texto para o
      // cliente copiar manualmente, em vez de falhar em silêncio.
      const el = document.getElementById('pix-code') as HTMLTextAreaElement | null
      el?.select()
    }
  }

  const approved = Boolean(charge?.approved) || cardApproved
  const expired = charge?.status === 'expired' || secondsLeft === 0

  return (
    <div className="page" style={{ paddingTop: 32, maxWidth: 720 }}>
      <button className="btn btn--ghost" onClick={() => navigate('/planos')} style={{ marginBottom: 16 }}>
        <ArrowLeft size={17} /> Voltar aos planos
      </button>

      <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,3vw,2.1rem)', marginBottom: 6 }}>
        Pagamento
      </h1>

      {/*
        Escolha do meio de pagamento.

        Só aparece quando há mais de um meio disponível: com o cartão desligado
        no servidor, uma aba que leva a "indisponível" é ruído. O Pix continua
        sendo o padrão.
      */}
      {cardEnabled && !approved && (
        <div className="inline" style={{ gap: 8, margin: '14px 0 4px' }}>
          <button
            className={`btn ${method === 'pix' ? 'btn--primary' : 'btn--outline'} btn--sm`}
            onClick={() => setMethod('pix')}
            aria-pressed={method === 'pix'}
          >
            Pix
          </button>
          <button
            className={`btn ${method === 'card' ? 'btn--primary' : 'btn--outline'} btn--sm`}
            onClick={() => setMethod('card')}
            aria-pressed={method === 'card'}
          >
            Cartão de crédito ou débito
          </button>
        </div>
      )}

      {/* ── Cartão ─────────────────────────────────────────────────────── */}
      {method === 'card' && cardEnabled && publicKey && !approved && (
        <div style={{ marginTop: 20 }}>
          <CardPaymentForm
            planCode={planCode}
            period={period}
            planName={charge?.plan.name ?? 'Plano'}
            periodLabel={charge?.period.label ?? ''}
            amountLabel={charge?.amount_label ?? ''}
            publicKey={publicKey}
            onApproved={() => setCardApproved(true)}
          />
        </div>
      )}

      {loading && method === 'pix' && <div className="skeleton" style={{ height: 320, marginTop: 20 }} />}

      {error && method === 'pix' && (
        <div className="alert alert--error" style={{ marginTop: 20 }}>
          <InfoIcon size={18} />
          <span>{error}</span>
        </div>
      )}

      {!loading && error && method === 'pix' && (
        <div className="panel" style={{ marginTop: 16 }}>
          <p className="panel-sub" style={{ marginBottom: 14 }}>
            Se o Pix não estiver disponível, você pode contratar pelo WhatsApp — respondemos por lá.
          </p>
          <a
            className="btn btn--primary"
            href={whatsappUrl('Olá! Quero assinar o MovieFlix.')}
            target="_blank"
            rel="noopener noreferrer"
          >
            Falar no WhatsApp
          </a>
        </div>
      )}

      {charge && !approved && method === 'pix' && (
        <>
          <div className="panel" style={{ marginTop: 20 }}>
            <div className="row-between" style={{ marginBottom: 4 }}>
              <div className="panel-title" style={{ marginBottom: 0 }}>
                {charge.plan.name} · {charge.period.label}
              </div>
              <span className="badge badge--purple">{charge.amount_label}</span>
            </div>
            <p className="muted" style={{ fontSize: '0.88rem', marginBottom: 18 }}>
              Escaneie o QR Code com o app do seu banco, ou copie o código abaixo. A liberação é
              automática assim que o pagamento for confirmado.
            </p>

            {charge.qr_code_base64 ? (
              <div style={{ textAlign: 'center', marginBottom: 18 }}>
                <img
                  src={`data:image/png;base64,${charge.qr_code_base64}`}
                  alt="QR Code Pix"
                  style={{
                    width: 260,
                    height: 260,
                    background: '#fff',
                    padding: 10,
                    borderRadius: 12,
                    display: 'inline-block',
                  }}
                />
              </div>
            ) : null}

            <label
              style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}
              htmlFor="pix-code"
            >
              Pix copia e cola
            </label>
            <textarea
              id="pix-code"
              readOnly
              value={charge.qr_code ?? ''}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
              style={{
                width: '100%',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                padding: 10,
                borderRadius: 8,
                border: '1px solid var(--border, #333)',
                background: 'rgba(255,255,255,0.04)',
                color: 'inherit',
                resize: 'none',
                marginBottom: 10,
              }}
            />
            <button className="btn btn--primary" onClick={copyCode} style={{ width: '100%' }}>
              {copied ? '✓ Código copiado' : 'Copiar código Pix'}
            </button>

            <div
              className="inline"
              style={{ marginTop: 16, justifyContent: 'space-between', fontSize: '0.82rem' }}
            >
              <span className="muted">
                Status:{' '}
                <strong>
                  {expired
                    ? 'Expirado'
                    : charge.status === 'pending'
                      ? 'Aguardando pagamento'
                      : charge.status}
                </strong>
              </span>
              {secondsLeft !== null && !expired && (
                <span className="muted">
                  Expira em {Math.floor(secondsLeft / 60)}:
                  {String(secondsLeft % 60).padStart(2, '0')}
                </span>
              )}
            </div>
          </div>

          {expired && (
            <div className="alert alert--info" style={{ marginTop: 16 }}>
              <InfoIcon size={18} />
              <span>
                Este Pix expirou. Gere um novo para concluir a contratação.
              </span>
            </div>
          )}

          <p className="muted" style={{ fontSize: '0.78rem', marginTop: 16, textAlign: 'center' }}>
            A tela atualiza sozinha. Você pode fechar e voltar depois — o pagamento continua valendo.
          </p>
        </>
      )}

      {approved && (
        <div className="panel" style={{ marginTop: 20, textAlign: 'center', padding: '36px 24px' }}>
          <div style={{ fontSize: '2.6rem', marginBottom: 12 }}>
            <CheckIcon size={44} />
          </div>
          <h2 className="panel-title" style={{ marginBottom: 10 }}>
            Pagamento confirmado!
          </h2>
          <p className="panel-sub" style={{ marginBottom: 6 }}>
            Sua assinatura MovieFlix foi ativada. Aproveite seus filmes e séries!
          </p>
          {charge?.plan_expires_at && (
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 20 }}>
              Válida até {new Date(charge.plan_expires_at).toLocaleDateString('pt-BR')}
            </p>
          )}
          <div className="inline" style={{ justifyContent: 'center' }}>
            <button className="btn btn--primary" onClick={() => navigate('/')}>
              Começar a assistir
            </button>
            <button className="btn btn--outline" onClick={() => navigate('/planos')}>
              Ver meu plano
            </button>
          </div>
        </div>
      )}
    </div>
  )
}