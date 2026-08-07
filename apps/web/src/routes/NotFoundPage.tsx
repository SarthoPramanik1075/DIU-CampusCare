import type { JSX } from 'react';

/**
 * X-01 · Not found (FRONTEND §10.13). Rendered identically for a record
 * that genuinely doesn't exist and one that exists but isn't the caller's
 * (BR-50, PRM-04) — a distinguishable 403 would confirm existence.
 *
 * "Role-appropriate home link" per the wireframe: only the public landing
 * page exists as a real destination so far (student/staff/admin home
 * screens are later M1 checkpoints), so that is the honest link today —
 * this will point at the caller's actual role home once those exist,
 * without needing to revisit this file.
 */
export function NotFoundPage(): JSX.Element {
  return (
    <main style={{ maxWidth: 'var(--container-content)', margin: '0 auto', padding: 'var(--space-4) var(--space-3)', textAlign: 'center' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>We couldn&apos;t find that page.</h1>
      <p style={{ marginTop: 'var(--space-2)' }}>
        <a href="/">Go to the homepage</a>
      </p>
    </main>
  );
}
