import type { JSX } from 'react';

import { ApiError } from '../infrastructure/api-client.js';
import { Button } from '../shared/primitives/Button.js';

export interface ErrorPageProps {
  readonly error?: unknown;
  readonly onRetry?: () => void;
}

/**
 * X-03 · Something went wrong (FRONTEND §10.13, NFR-USE-06/MNT-03/SEC-07).
 * No stack trace, no internal identifier — only a correlation ID, and only
 * when the failure actually carried one (an `ApiError`); a client-side
 * exception with no server round trip has no correlation ID to show, and
 * fabricating one would defeat its purpose (matching a support ticket to a
 * real server-side log line).
 */
export function ErrorPage({ error, onRetry }: ErrorPageProps): JSX.Element {
  const correlationId = error instanceof ApiError ? error.correlationId : undefined;

  return (
    <main style={{ maxWidth: 'var(--container-content)', margin: '0 auto', padding: 'var(--space-4) var(--space-3)', textAlign: 'center' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>Something went wrong. Your data is safe.</h1>
      {correlationId !== undefined && (
        <p style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
          Reference: <code style={{ userSelect: 'all' }}>{correlationId}</code>
        </p>
      )}
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Button
          variant="primary"
          onClick={() => {
            if (onRetry !== undefined) {
              onRetry();
              return;
            }
            window.location.reload();
          }}
        >
          Try again
        </Button>
      </div>
    </main>
  );
}
