import type { JSX } from 'react';

import './StatusBadge.css';
import { Icon, type IconName } from './icons.js';

export type StatusTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface StatusBadgeProps {
  readonly tone: StatusTone;
  readonly icon: IconName;
  readonly label: string;
}

/**
 * FRONTEND §5.2 — the component that makes NFR-A11Y-04 / obligation O3
 * structural. `tone`, `icon` and `label` are all required: there is no
 * colour-only variant, and the type system makes constructing one
 * impossible rather than merely discouraged. Not interactive — never a
 * button, never a link, no focus, no hover — and the icon is `aria-hidden`
 * because the label already carries the meaning as text for a screen
 * reader.
 *
 * The icon/tone/label combination for each domain status comes from the
 * assignment table in FRONTEND §4.1.4, which is this component's single
 * source; a badge is never constructed with an invented mapping.
 */
export function StatusBadge({ tone, icon, label }: StatusBadgeProps): JSX.Element {
  return (
    <span className={`cc-badge cc-badge--${tone}`}>
      <Icon name={icon} />
      {label}
    </span>
  );
}
