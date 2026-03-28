import { forwardRef } from 'react';

/**
 * Input — accessible text input with label, helper text, and error state.
 *
 * @param {string} label       Visible label (required for accessibility)
 * @param {string} id          Ties label to input; auto-derived from label if omitted
 * @param {string} error       Error message; sets aria-invalid and shows message
 * @param {string} hint        Helper text shown below the input
 * @param {boolean} fullWidth
 */
export const Input = forwardRef(function Input(
  { label, id, error, hint, fullWidth = false, className = '', ...props },
  ref
) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className={['input-wrap', fullWidth ? 'input-full' : '', className].filter(Boolean).join(' ')}>
      {label && (
        <label className="input-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={['input-field', error ? 'input-error' : ''].filter(Boolean).join(' ')}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        {...props}
      />
      {error && (
        <span id={`${inputId}-error`} className="input-error-msg" role="alert">
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={`${inputId}-hint`} className="input-hint">
          {hint}
        </span>
      )}
    </div>
  );
});
