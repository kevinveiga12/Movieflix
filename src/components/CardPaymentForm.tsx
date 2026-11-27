import { useState } from 'react'
import { createCardCharge, tokenizeCard } from '../lib/access'
import type { CardCharge } from '../lib/types'
import { CheckIcon, InfoIcon } from './Icons'

/**
 * Pagamento com cartão de crédito ou débito.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * O DADO DO CARTÃO NUNCA SAI DAQUI
 * ══════════════════════════════════════════════════════════════════════════════
 * O número, o CVV e a validade existem apenas no estado deste componente
 * enquanto a pessoa digita. Ao confirmar, `tokenizeCard` os envia DIRETO ao
 * Mercado Pago (com a chave pública) e recebe de volta um token de uso único.
 *
 * O que vai para o servidor do MovieFlix é só `{ token, payment_method_id }`.
 * Não há `fetch` para o nosso backend com dado de cartão em nenhum ponto deste
 * arquivo — e não há como adicionar sem quebrar o tipo de `createCardCharge`.
 *
 * Nada é gravado em localStorage, sessionStorage ou log. Ao desmontar o
 * componente, o estado morre com ele.
 */

interface Props {
  planCode: string
  period: string
  planName: string
  periodLabel: string
  amountLabel: string
  publicKey: string
  onApproved: (charge: CardCharge) => void
}

/** Formata 4111111111111111 → 4111 1111 1111 1111 */
function formatCardNumber(v: string) {
  const digits = v.replace(/\D/g, '').slice(0, 19)
  return digits.replace(/(.{4})/g, '$1 ').trim()
}

/** Formata MM/AA a partir de dígitos. */
function formatExpiry(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 4)
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}/${d.slice(2)}`
}

export function CardPaymentForm({
  planCode,
  period,
  planName,
  periodLabel,
  amountLabel,
  publicKey,
  onApproved,
}: Props) {
  const [number, setNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')
  const [holder, setHolder] = useState('')
  const [cpf, setCpf] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CardCharge | null>(null)

  const digits = number.replace(/\D/g, '')
  const canSubmit =
    digits.length >= 13 && expiry.length === 5 && cvv.length >= 3 && holder.trim().length >= 3

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || busy) return

    setBusy(true)
    setError(null)

    const [mm, yy] = expiry.split('/')

    try {
      /*
        Passo 1 — tokenizar no Mercado Pago.
        Se o cartão for inválido (Luhn, validade vencida), falha AQUI, antes de
        qualquer cobrança. Nenhum valor é movimentado.
      */
      const tok = await tokenizeCard({
        publicKey,
        cardNumber: digits,
        expirationMonth: mm,
        expirationYear: yy?.length === 2 ? `20${yy}` : yy,
        securityCode: cvv,
        cardholderName: holder.trim(),
        identificationNumber: cpf.replace(/\D/g, '') || undefined,
      })

      if (!tok.paymentMethodId) {
        throw new Error('Bandeira do cartão não identificada. Confira o número.')
      }

      /*
        Passo 2 — cobrar com o token. O servidor resolve o preço; o valor que
        aparece na tela é só informativo.
      */
      const charge = await createCardCharge({
        planCode,
        period,
        token: tok.token,
        paymentMethodId: tok.paymentMethodId,
        issuerId: tok.issuerId,
      })

      setResult(charge)

      // Limpa o formulário assim que o token foi usado: o cartão não fica
      // na memória do componente depois de cobrado.
      setNumber('')
      setCvv('')
      setExpiry('')

      if (charge.approved) onApproved(charge)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /* ── Aprovado ─────────────────────────────────────────────────────────── */
  if (result?.approved) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: '36px 24px' }}>
        <div style={{ fontSize: '2.6rem', marginBottom: 12 }}>
          <CheckIcon size={44} />
        </div>
        <h2 className="panel-title" style={{ marginBottom: 10 }}>
          Pagamento confirmado!
        </h2>
        <p className="panel-sub" style={{ marginBottom: 6 }}>
          Sua assinatura MovieFlix foi ativada. Aproveite seus filmes e séries!
        </p>
        {result.plan_expires_at && (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Válida até {new Date(result.plan_expires_at).toLocaleDateString('pt-BR')}
          </p>
        )}
      </div>
    )
  }

  /* ── Recusado / em análise ────────────────────────────────────────────── */
  if (result && !result.approved) {
    const pending = result.status === 'in_process' || result.status === 'pending'
    return (
      <div className="panel" style={{ padding: '28px 24px' }}>
        <div className={`alert ${pending ? 'alert--info' : 'alert--error'}`} style={{ marginBottom: 16 }}>
          <InfoIcon size={18} />
          <span>{result.message ?? 'Não foi possível confirmar o pagamento.'}</span>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 16 }}>
          {pending
            ? 'A tela atualiza sozinha. Você pode fechar e voltar depois — o pagamento continua valendo.'
            : 'Nenhum valor foi cobrado. Você pode tentar outro cartão ou pagar com Pix.'}
        </p>
        <button
          className="btn btn--outline"
          onClick={() => {
            setResult(null)
            setError(null)
          }}
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  /* ── Formulário ───────────────────────────────────────────────────────── */
  return (
    <form className="panel" onSubmit={submit} style={{ padding: '24px' }}>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <div className="panel-title" style={{ marginBottom: 0 }}>
          {planName} · {periodLabel}
        </div>
        <span className="badge badge--purple">{amountLabel}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 18 }}>
        Crédito ou débito. Os dados são enviados direto ao Mercado Pago — o MovieFlix não
        armazena o número do seu cartão.
      </p>

      {error && (
        <div className="alert alert--error" style={{ marginBottom: 16 }}>
          <InfoIcon size={18} />
          <span>{error}</span>
        </div>
      )}

      <label style={labelStyle} htmlFor="cc-number">
        Número do cartão
      </label>
      <input
        id="cc-number"
        inputMode="numeric"
        autoComplete="cc-number"
        placeholder="0000 0000 0000 0000"
        value={number}
        onChange={(e) => setNumber(formatCardNumber(e.target.value))}
        style={inputStyle}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle} htmlFor="cc-exp">
            Validade
          </label>
          <input
            id="cc-exp"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/AA"
            value={expiry}
            onChange={(e) => setExpiry(formatExpiry(e.target.value))}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="cc-cvv">
            CVV
          </label>
          <input
            id="cc-cvv"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            maxLength={4}
            value={cvv}
            onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
            style={inputStyle}
          />
        </div>
      </div>

      <label style={labelStyle} htmlFor="cc-name">
        Nome impresso no cartão
      </label>
      <input
        id="cc-name"
        autoComplete="cc-name"
        placeholder="Como está no cartão"
        value={holder}
        onChange={(e) => setHolder(e.target.value.toUpperCase())}
        style={inputStyle}
      />

      <label style={labelStyle} htmlFor="cc-cpf">
        CPF do titular <span className="muted">(opcional)</span>
      </label>
      <input
        id="cc-cpf"
        inputMode="numeric"
        placeholder="000.000.000-00"
        value={cpf}
        onChange={(e) => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))}
        style={inputStyle}
      />

      <button
        type="submit"
        className="btn btn--primary"
        disabled={!canSubmit || busy}
        style={{ width: '100%', marginTop: 8, opacity: !canSubmit || busy ? 0.6 : 1 }}
      >
        {busy ? 'Processando…' : `Pagar ${amountLabel}`}
      </button>

      <p className="muted" style={{ fontSize: '0.72rem', marginTop: 12, textAlign: 'center' }}>
        Pagamento processado pelo Mercado Pago. A liberação é automática após a aprovação.
      </p>
    </form>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 700,
  marginBottom: 6,
  marginTop: 12,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 12px',
  borderRadius: 8,
  border: '1px solid var(--border, #333)',
  background: 'rgba(255,255,255,0.04)',
  color: 'inherit',
  fontSize: '0.95rem',
  fontFamily: 'inherit',
}
