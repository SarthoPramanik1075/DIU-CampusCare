import type { JSX } from 'react';

import './Banner.css';
import { Icon, type IconName } from './icons.js';

interface BannerCommon {
  readonly heading?: string;
  readonly message: string;
  readonly actionLabel?: string;
  readonly actionHref?: string;
}

/**
 * FRONTEND §5.8: "Dismissible only when purely informational. A banner
 * conveying an active constraint — a suspension, an offline state, an
 * active break-glass grant — is not dismissible, because dismissing it
 * does not change the constraint." A discriminated union on `tone` makes
 * `onDismiss` a type error on `warning`/`danger`, rather than a convention
 * a caller could forget.
 */
export type BannerProps =
  | (BannerCommon & { readonly tone: 'info' | 'success'; readonly onDismiss?: () => void })
  | (BannerCommon & { readonly tone: 'warning' | 'danger' });

const TONE_ICON: Record<BannerProps['tone'], IconName> = {
  info: 'info',
  success: 'check',
  warning: 'alert-triangle',
  danger: 'alert-circle',
};

export function Banner(props: BannerProps): JSX.Element {
  const { tone, heading, message, actionLabel, actionHref } = props;
  const isInformational = tone === 'info' || tone === 'success';
  const role = isInformational ? 'status' : 'alert';
  // The union above makes `onDismiss` a type error on warning/danger, but a
  // plain JS caller (or a `@ts-expect-error`-forced one) could still pass
  // it through — FRONTEND §5.8's "is not dismissible" is a runtime property
  // of the constraint being conveyed, not just a type-checker convenience,
  // so it is re-asserted here rather than trusted to the type alone.
  const onDismiss = isInformational && 'onDismiss' in props ? props.onDismiss : undefined;

  return (
    <div className={`cc-banner cc-banner--${tone}`} role={role}>
      <Icon name={TONE_ICON[tone]} className="cc-banner__icon" />
      <div className="cc-banner__body">
        {heading !== undefined && <p className="cc-banner__heading">{heading}</p>}
        <p className="cc-banner__message">{message}</p>
        {actionLabel !== undefined && actionHref !== undefined && (
          <a className="cc-banner__action" href={actionHref}>
            {actionLabel}
          </a>
        )}
      </div>
      {onDismiss !== undefined && (
        <button
          type="button"
          className="cc-banner__dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}
