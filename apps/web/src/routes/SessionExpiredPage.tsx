import { useNavigate } from '@tanstack/react-router';
import type { JSX } from 'react';

import { Button } from '../shared/primitives/Button.js';

/**
 * X-05 · Session expired (FRONTEND §10.13, EC-49, FR-AUTH-06). "On
 * re-authentication returns to the availability list, never a held slot" —
 * there is no slot-holding flow yet (booking is M2), so this links to
 * sign-in with no `redirectTo`, the honest equivalent until that exists.
 */
export function SessionExpiredPage(): JSX.Element {
  const navigate = useNavigate();

  return (
    <main style={{ maxWidth: 'var(--container-content)', margin: '0 auto', padding: 'var(--space-4) var(--space-3)', textAlign: 'center' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>Your session timed out.</h1>
      <p style={{ marginTop: 'var(--space-2)' }}>Sign in again to continue.</p>
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Button
          variant="primary"
          onClick={() => {
            void navigate({ to: '/sign-in' });
          }}
        >
          Sign in again
        </Button>
      </div>
    </main>
  );
}
