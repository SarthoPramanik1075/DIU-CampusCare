import type { JSX } from 'react';

import type { SessionDto } from '../features/auth/api.js';
import { StaffShell } from '../shared/StaffShell.js';

export interface StaffHomePageProps {
  readonly session: SessionDto;
}

/**
 * `/staff` chrome for Medical Center Staff. F-01's queue console (CON-01,
 * FRONTEND §9.2) is the real destination this rail exists for, but it — and
 * everything else in FRONTEND §10.4 (walk-ins, payments, schedules,
 * doctors) — is M2+ scope. This is the honest home in the meantime: real
 * routing and role-appropriate chrome, no invented queue or fabricated
 * counts standing in for it.
 */
export function StaffHomePage({ session }: StaffHomePageProps): JSX.Element {
  return (
    <StaffShell session={session} pageTitle="Medical centre">
      <p style={{ color: 'var(--color-text-secondary)' }}>
        There&rsquo;s nothing here yet. The queue console and other medical-centre screens ship in a later milestone.
      </p>
    </StaffShell>
  );
}
