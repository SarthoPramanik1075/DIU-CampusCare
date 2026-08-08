import type { JSX } from 'react';

import type { SessionDto } from '../features/auth/api.js';
import { StaffShell } from '../shared/StaffShell.js';

export interface OperatorHomePageProps {
  readonly session: SessionDto;
}

/**
 * `/operator` chrome for the Store Operator. O-01's exceptions dashboard
 * (FRONTEND §9.3) and the medicine catalogue/stock/dispense screens
 * (§10.4) are all M2+ scope. Real routing and role-appropriate chrome now,
 * no fabricated catalogue or stock counts standing in for them.
 */
export function OperatorHomePage({ session }: OperatorHomePageProps): JSX.Element {
  return (
    <StaffShell session={session} pageTitle="Medicine store">
      <p style={{ color: 'var(--color-text-secondary)' }}>
        There&rsquo;s nothing here yet. The catalogue and stock screens ship in a later milestone.
      </p>
    </StaffShell>
  );
}
