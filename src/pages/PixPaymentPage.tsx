import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { createPixCharge, fetchPaymentStatus, whatsappUrl } from '../lib/access'
import type { PixCharge } from '../lib/types'
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

  /**
   * CPF do titular.
   *
   * O Mercado Pago exige `payer.identification` para criar o Pix. Coletamos
   * aqui, antes de pedir a cobrança; o servidor valida os dígitos
   * verificadores — a tela só confere o formato para dar retorno rápido.
   */
  const [cpf, setCpf] = useState('')
  const [cpfError, setCpfError] = useState<string | null>(null)
  const [cpfConfirmed, setCpfConfirmed] = useState(false)

  const startedAt = useRef(Date.now())
  const pollTimer = useRef<number | null>(null)

  /* ── Cria a cobrança uma vez, depois do CPF confirmado ─────────────────── */
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
    if (!cpfConfirmed) {
      // Ainda não temos o CPF: não chama o servidor.
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    ;(async () => {
      try {
        const c = await createPixCharge({ planCode, period, cpf })
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
  }, [user, planCode, period, cpf, cpfConfirmed, navigate])

  /** Confere o formato do CPF (11 dígitos) antes de pedir a cobrança. */
  function confirmCpf() {
    const digits = cpf.replace(/\D/g, '')
    if (digits.length !== 11) {
      setCpfError('O CPF precisa ter 11 dígitos.')
      return
    }
    if (/^(\d)\1{10}$/.test(digits)) {
      setCpfError('Este CPF não é válido. Confira os números.')
      return
    }
    setCpfError(null)
    setCpf(digits)
    setCpfConfirmed(true)
  }

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

  const approved = Boolean(charge?.approved)
  const expired = charge?.status === 'expired' || secondsLeft === 0

  return (
    <div className="page" style={{ paddingTop: 32, maxWidth: 720 }}>
      <button className="btn btn--ghost" onClick={() => navigate('/planos')} style={{ marginBottom: 16 }}>
        <ArrowLeft size={17} /> Voltar aos planos
      </button>

      <h1 className="section-title" style={{ fontSize: 'clamp(1.5rem,3vw,2.1rem)', marginBottom: 6 }}>
        Pagamento por Pix
      </h1>

      {loading && <div className="skeleton" style={{ height: 320, marginTop: 20 }} />}

      {/* ── Etapa do CPF: obrigatória antes de gerar o Pix ─────────────── */}
      {!cpfConfirmed && !loading && !error && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel-title" style={{ marginBottom: 6 }}>
            Informe seu CPF
          </div>
          <p className="muted" style={{ fontSize: '0.88rem', marginBottom: 16 }}>
            O Mercado Pago exige o CPF do titular para emitir a cobrança Pix. Ele é usado
            apenas na geração do pagamento.
          </p>
          <label
            htmlFor="pix-cpf"
            style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: 6 }}
          >
            CPF
          </label>
          <input
            id="pix-cpf"
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00"
            value={cpf}
            maxLength={14}
            onChange={(e) => {
              setCpf(e.target.value)
              if (cpfError) setCpfError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmCpf()
            }}
            style={{
              width: '100%',
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${cpfError ? '#e5484d' : 'var(--border, #333)'}`,
              background: 'rgba(255,255,255,0.04)',
              color: 'inherit',
              fontSize: '1rem',
              marginBottom: cpfError ? 6 : 14,
            }}
          />
          {cpfError && (
            <p style={{ color: '#e5484d', fontSize: '0.82rem', marginBottom: 12 }}>{cpfError}</p>
          )}
          <button className="btn btn--primary" onClick={confirmCpf} style={{ width: '100%' }}>
            Gerar Pix
          </button>
        </div>
      )}

      {error && (
        <div className="alert alert--error" style={{ marginTop: 20 }}>
          <InfoIcon size={18} />
          <span>{error}</span>
        </div>
      )}

      {!loading && error && (
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

      {charge && !approved && (
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