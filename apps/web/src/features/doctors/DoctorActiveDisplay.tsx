import type { JSX } from 'react';

import { Icon } from '../../shared/primitives/icons.js';

/**
 * F-09's "Inactive shown with `— Inactive` badge" — active/inactive isn't
 * one of the domain statuses FRONTEND §4.1.4's colour table covers, so
 * this is icon + coloured text (never colour alone, per O3), same choice
 * `AccountStatusDisplay` made for account status.
 */
export function DoctorActiveDisplay({ isActive }: { readonly isActive: boolean }): JSX.Element {
  return isActive ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-0-5)', color: 'var(--color-success)' }}>
      <Icon name="check" aria-hidden="true" />
      Active
    </span>
  ) : (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-0-5)', color: 'var(--color-text-secondary)' }}>
      <Icon name="x" aria-hidden="true" />
      Inactive
    </span>
  );
}
