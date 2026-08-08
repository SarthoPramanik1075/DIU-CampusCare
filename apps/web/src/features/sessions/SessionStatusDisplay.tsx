import type { JSX } from 'react';

import { Icon, type IconName } from '../../shared/primitives/icons.js';

import type { SessionStatus } from './api.js';

/**
 * Clinic-session status (`scheduled`/`started`/`interrupted`/`completed`/
 * `cancelled`) isn't one of the rows FRONTEND §4.1.4's colour table
 * covers — that table is appointment/medicine/payment/case/SLA/
 * connection/command status only. Same choice `AccountStatusDisplay` and
 * `DoctorActiveDisplay` made: icon + coloured text (never colour alone,
 * O3), not a `StatusBadge` claiming a spec source it doesn't have.
 */
const STATUS_DISPLAY: Record<SessionStatus, { readonly icon: IconName; readonly label: string; readonly color: string }> = {
  scheduled: { icon: 'clock', label: 'Scheduled', color: 'var(--color-text-secondary)' },
  started: { icon: 'check', label: '▶ Running', color: 'var(--color-success)' },
  interrupted: { icon: 'alert-triangle', label: 'Interrupted', color: 'var(--color-warning)' },
  completed: { icon: 'check', label: 'Completed', color: 'var(--color-text-secondary)' },
  cancelled: { icon: 'x', label: 'Cancelled', color: 'var(--color-danger)' },
};

export function SessionStatusDisplay({ status }: { readonly status: SessionStatus }): JSX.Element {
  const display = STATUS_DISPLAY[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-0-5)', color: display.color }}>
      <Icon name={display.icon} aria-hidden="true" />
      {display.label}
    </span>
  );
}
