import type { JSX, ReactNode } from 'react';

import { AppHeader } from './AppHeader.js';

export interface AuthCardProps {
  readonly title: string;
  readonly children: ReactNode;
}

/**
 * The bordered, shadowed card shape shared by every unauthenticated
 * single-task screen (P-06 sign-in, P-07/P-08 password reset) — pulled out
 * once these hit three call sites, rather than duplicating the same six
 * inline style props a third time.
 */
export function AuthCard({ title, children }: AuthCardProps): JSX.Element {
  return (
    <>
      <AppHeader />
      <main style={{ maxWidth: 'var(--container-narrow)', margin: 'var(--space-6) auto', padding: '0 var(--space-3)' }}>
        <div
          style={{
            background: 'var(--color-bg)',
            border: 'var(--border-width) solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            padding: 'var(--space-4)',
          }}
        >
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 0, marginBottom: 'var(--space-3)' }}>{title}</h1>
          {children}
        </div>
      </main>
    </>
  );
}
