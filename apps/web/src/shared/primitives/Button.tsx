import { forwardRef, useId, type MouseEvent, type ReactNode } from 'react';

import './Button.css';
import { Icon, type IconName } from './icons.js';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  readonly variant: ButtonVariant;
  readonly children: ReactNode;
  readonly size?: ButtonSize;
  readonly icon?: IconName;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  /**
   * FRONTEND §5.1: "Disabled buttons always carry a reason." Rendered as
   * both a `title` hint and visible help text linked by `aria-describedby`
   * — a disabled control with no explanation is the single most common
   * frustration in staff software.
   */
  readonly disabledReason?: string;
  readonly type?: 'button' | 'submit';
  readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * FRONTEND §5.1. `aria-disabled` is used instead of the native `disabled`
 * attribute for both the `disabled` and `loading` states: a natively
 * disabled button cannot hold focus, and "a loading button retains focus"
 * is a stated keyboard requirement — moving focus on completion would
 * strand a keyboard user.
 */
/** Forwards its ref to the underlying `<button>` — needed by callers that manage focus explicitly, e.g. `ConfirmDialog`'s §5.5 requirement that initial focus lands on the cancel/safe action. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { variant, children, size = 'md', icon, loading = false, disabled = false, disabledReason, type = 'button' } =
    props;
  const isInert = disabled || loading;
  const generatedId = useId();
  const helpId = disabledReason !== undefined ? `${generatedId}-help` : undefined;

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    if (isInert) {
      event.preventDefault();
      return;
    }
    props.onClick?.(event);
  }

  return (
    <>
      <button
        ref={ref}
        type={type}
        className={`cc-button cc-button--${variant} cc-button--${size}`}
        aria-disabled={isInert ? 'true' : undefined}
        aria-busy={loading ? 'true' : undefined}
        aria-describedby={helpId}
        title={isInert ? disabledReason : undefined}
        onClick={handleClick}
      >
        {loading ? (
          <Icon name="refresh" className="cc-button__spinner" />
        ) : icon !== undefined ? (
          <Icon name={icon} />
        ) : null}
        {children}
      </button>
      {isInert && disabledReason !== undefined && (
        <span id={helpId} className="cc-button__help">
          {disabledReason}
        </span>
      )}
    </>
  );
});
