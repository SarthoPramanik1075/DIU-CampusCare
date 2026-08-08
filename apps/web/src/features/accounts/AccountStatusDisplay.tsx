import type { JSX } from 'react';

import { Icon, type IconName } from '../../shared/primitives/icons.js';

import type { AccountStatus } from './api.js';

/**
 * FRONTEND §4.1.4's status-colour table does not cover account status
 * (`pending`/`active`/`suspended`/`deactivated`) — only appointment,
 * medicine, payment, case, SLA, connection and command statuses are listed
 * there, and "badges do not invent their own mappings" (§4.1.4). This is
 * the same choice `StudentDashboardPage` made for the medicine-store state:
 * icon + coloured text, not a `StatusBadge` claiming a spec source it
 * doesn't have.
 */
const STATUS_DISPLAY: Record<AccountStatus, { readonly icon: IconName; readonly label: string; readonly color: string }> = {
  pending: { icon: 'clock', label: 'Pending', color: 'var(--color-text-secondary)' },
  active: { icon: 'check', label: 'Active', color: 'var(--color-success)' },
  suspended: { icon: 'alert-triangle', label: 'Suspended', color: 'var(--color-warning)' },
  deactivated: { icon: 'x', label: 'Deactivated', color: 'var(--color-danger)' },
};

export function AccountStatusDisplay({ status }: { readonly status: AccountStatus }): JSX.Element {
  const display = STATUS_DISPLAY[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-0-5)', color: display.color }}>
      <Icon name={display.icon} aria-hidden="true" />
      {display.label}
    </span>
  );
}
