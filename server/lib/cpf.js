/**
 * Validação de CPF — lógica pura, sem dependências.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 * O Mercado Pago passou a EXIGIR `payer.identification` na criação de cobrança
 * Pix. Sem o CPF, a API responde 400 e o cliente fica sem QR Code — foi
 * exatamente o erro que a produção apresentava.
 *
 * A validação acontece no SERVIDOR, não só na tela: o cliente pode ser o site,
 * o app Android ou a TV, e nenhum deles é confiável. Um CPF com dígito
 * verificador errado é recusado aqui, antes de gastar uma chamada na API do
 * provedor.
 *
 * O CPF NUNCA é gravado em log, em arquivo de pagamento ou devolvido ao
 * cliente. Ele só existe em memória, no corpo da requisição ao Mercado Pago.
 */

/** Remove tudo que não é dígito. `123.456.789-09` → `12345678909`. */
export function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * CPF FIXO do dono da conta — usado em TODA cobrança Pix.
 *
 * O cliente NÃO digita CPF: o Mercado Pago exige `payer.identification` para
 * emitir o Pix, e a cobrança é sempre emitida no CPF do titular da conta
 * MovieFlix. Este valor vive só no servidor: nunca é enviado ao navegador, ao
 * app Android ou à TV, e qualquer CPF que o cliente tente mandar é ignorado.
 *
 * `561.807.618-76` → `56180761876` (dígitos verificadores conferidos).
 */
export const OWNER_CPF = '56180761876'

/** Identificação pronta para `payer.identification` do Mercado Pago. */
export function ownerIdentification() {
  return { type: 'CPF', number: OWNER_CPF }
}

/**
 * Valida um CPF pelos dígitos verificadores.
 *
 * Regras aplicadas:
 *   • precisa ter exatamente 11 dígitos;
 *   • sequências repetidas (`11111111111`, `00000000000`) são inválidas por
 *     convenção da Receita — passam no cálculo, mas não são CPFs reais;
 *   • os dois últimos dígitos são conferidos pelo módulo 11.
 *
 * Devolve `{ ok, reason, digits }`. `digits` só vem preenchido quando ok.
 */
export function validateCpf(value) {
  const digits = onlyDigits(value)

  if (!digits) return { ok: false, reason: 'empty', digits: null }
  if (digits.length !== 11) return { ok: false, reason: 'length', digits: null }
  if (/^(\d)\1{10}$/.test(digits)) return { ok: false, reason: 'repeated', digits: null }

  const nums = digits.split('').map(Number)

  const checkDigit = (count) => {
    let sum = 0
    for (let i = 0; i < count; i++) sum += nums[i] * (count + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }

  if (checkDigit(9) !== nums[9]) return { ok: false, reason: 'check_digit_1', digits: null }
  if (checkDigit(10) !== nums[10]) return { ok: false, reason: 'check_digit_2', digits: null }

  return { ok: true, reason: null, digits }
}

/** Formata para exibição: `12345678909` → `123.456.789-09`. */
export function formatCpf(value) {
  const d = onlyDigits(value)
  if (d.length !== 11) return d
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/**
 * Mensagem para o cliente.
 *
 * Curta e sem detalhe técnico: o motivo exato (`check_digit_2`) não ajuda quem
 * está comprando, e expor a regra interna só facilita sonda automatizada.
 */
export function cpfErrorMessage(reason) {
  if (reason === 'empty') return 'Informe o CPF do titular para gerar o Pix.'
  if (reason === 'length') return 'O CPF precisa ter 11 dígitos.'
  if (reason === 'repeated') return 'Este CPF não é válido. Confira os números.'
  return 'CPF inválido. Confira os números e tente novamente.'
}
