import type { JSX } from 'react';

/**
 * X-02 · No access (FRONTEND §10.13, PRM-02/PRM-12, EC-45). Never names the
 * resource or the missing permission — the server already logged the
 * attempt (`audit.authz_denial`, PRM-12) before this ever rendered.
 */
export function NoAccessPage(): JSX.Element {
  return (
    <main style={{ maxWidth: 'var(--container-content)', margin: '0 auto', padding: 'var(--space-4) var(--space-3)', textAlign: 'center' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>You don&apos;t have access to this area.</h1>
      <p style={{ marginTop: 'var(--space-2)' }}>
        <a href="/">Go to the homepage</a>
      </p>
    </main>
  );
}
