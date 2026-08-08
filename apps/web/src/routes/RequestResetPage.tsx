import { useState, type JSX } from 'react';

import { requestPasswordReset } from '../features/auth/api.js';
import { ApiError } from '../infrastructure/api-client.js';
import { AuthCard } from '../shared/AuthCard.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button } from '../shared/primitives/Button.js';
import { Input } from '../shared/primitives/Input.js';

/**
 * P-07 · Request password reset (FRONTEND.md, API §1.7). "Always the same
 * success message, whether or not the account exists" is enforced entirely
 * server-side (the handler returns identical 202s either way) — this page
 * just displays whatever it's given, so there is no separate client-side
 * branch that could accidentally leak the distinction.
 */
export function RequestResetPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [successMessage, setSuccessMessage] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {
    setFieldError(undefined);
    setSubmitting(true);
    try {
      const result = await requestPasswordReset(email);
      setSuccessMessage(result.message);
    } catch (error) {
      setFieldError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (successMessage !== undefined) {
    return (
      <AuthCard title="Reset your password">
        <Banner tone="success" message={successMessage} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
      >
        <Input
          label="University email"
          type="email"
          value={email}
          onChange={setEmail}
          required
          autoComplete="username"
          {...(fieldError === undefined ? {} : { error: fieldError })}
        />
        <Button variant="primary" type="submit" loading={submitting}>
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
