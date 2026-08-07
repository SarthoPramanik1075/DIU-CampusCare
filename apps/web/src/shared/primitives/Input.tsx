import { useId, useState, type ChangeEvent, type JSX } from 'react';

import './Input.css';
import { Icon } from './icons.js';

export interface InputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly required?: boolean;
  readonly help?: string;
  readonly error?: string;
  readonly type?: 'text' | 'email' | 'search' | 'password';
  readonly inputMode?: 'text' | 'numeric' | 'email' | 'search';
  readonly autoComplete?: string;
  readonly placeholder?: string;
}

/**
 * FRONTEND §5.6. The label is always visible above the field — never a
 * placeholder-as-label, which vanishes on input and fails SC 3.3.2. An
 * error is always three signals at once (the 2px danger border, the ⚠
 * icon, and the message) rather than colour alone, applying the O3
 * principle to form state.
 *
 * `type="password"` renders the 👁 visibility toggle the P-06/P-08
 * wireframes show — masked by default, revealed only while the control has
 * focus-equivalent intent from the user (a deliberate click/tap), never
 * defaulting to visible.
 */
export function Input(props: InputProps): JSX.Element {
  const { label, value, onChange, required = false, help, error, type = 'text', inputMode, autoComplete, placeholder } =
    props;
  const id = useId();
  const helpId = help !== undefined ? `${id}-help` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  const describedBy =
    [helpId, errorId].filter((candidate): candidate is string => candidate !== undefined).join(' ') || undefined;
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.target.value);
  }

  return (
    <div className="cc-field">
      <label htmlFor={id} className="cc-field__label">
        {label}
        {required && (
          <span className="cc-field__required" aria-hidden="true">
            ※
          </span>
        )}
      </label>
      <div className={isPassword ? 'cc-field__input-group' : undefined}>
        <input
          id={id}
          className="cc-field__input"
          type={isPassword ? (revealed ? 'text' : 'password') : type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          required={required}
          aria-required={required ? 'true' : undefined}
          aria-invalid={error !== undefined ? 'true' : undefined}
          aria-describedby={describedBy}
        />
        {isPassword && (
          <button
            type="button"
            className="cc-field__reveal"
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            onClick={() => {
              setRevealed((current) => !current);
            }}
          >
            <Icon name={revealed ? 'eye-off' : 'eye'} />
          </button>
        )}
      </div>
      {help !== undefined && (
        <span id={helpId} className="cc-field__help">
          {help}
        </span>
      )}
      {error !== undefined && (
        <span id={errorId} className="cc-field__error" role="alert">
          <Icon name="alert-triangle" />
          {error}
        </span>
      )}
    </div>
  );
}
