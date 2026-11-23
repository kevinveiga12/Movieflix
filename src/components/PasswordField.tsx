import { useState } from 'react'
import { EyeIcon, EyeOffIcon } from './Icons'

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  placeholder?: string
  required?: boolean
  /** Mensagem de erro do campo (aplica `.input--error`). */
  invalid?: boolean
  /** Texto auxiliar abaixo do campo (ex.: "mínimo 6 caracteres"). */
  hint?: string
}

/**
 * Campo de senha com botão de olho.
 *
 * ── Comportamento ───────────────────────────────────────────────────────────
 *
 * A senha começa SEMPRE escondida (`type="password"`). O botão de olho só
 * aparece depois que a pessoa começa a digitar — antes disso não há nada para
 * conferir e o ícone só poluiria o campo. Ao tocar no olho a senha fica
 * visível; ao tocar de novo volta a ficar escondida.
 *
 * ── Segurança ───────────────────────────────────────────────────────────────
 *
 * Nada muda na autenticação: o valor continua sendo enviado exatamente como
 * antes, pelo mesmo `signIn`/`signUp`. O que muda é apenas o `type` do input,
 * que é um atributo de apresentação do navegador. A senha nunca é gravada em
 * localStorage, sessionStorage, cookie ou log — o estado vive só na memória do
 * componente e desaparece quando a página é fechada.
 *
 * O botão é `type="button"` de propósito: dentro de um <form>, um botão sem
 * tipo envia o formulário, e tocar no olho faria login sem a pessoa querer.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder = '••••••••',
  required = true,
  invalid = false,
  hint,
}: Props) {
  const [visible, setVisible] = useState(false)
  const hasText = value.length > 0

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-wrap">
        <input
          id={id}
          className={`input input--password${invalid ? ' input--error' : ''}`}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {hasText && (
          <button
            type="button"
            className={`password-eye${visible ? ' is-visible' : ''}`}
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Esconder senha' : 'Mostrar senha'}
            aria-pressed={visible}
            title={visible ? 'Esconder senha' : 'Mostrar senha'}
            tabIndex={0}
          >
            {visible ? <EyeOffIcon size={19} /> : <EyeIcon size={19} />}
          </button>
        )}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}
