import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { confirmPasswordReset } from '../features/auth/api.js';
import { evaluatePasswordComplexity } from '../features/auth/password-complexity.js';
import { ApiError } from '../infrastructure/api-client.js';
import { AuthCard } from '../shared/AuthCard.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button } from '../shared/primitives/Button.js';
import { Icon } from '../shared/primitives/icons.js';
import { Input } from '../shared/primitives/Input.js';

interface CriterionProps {
  readonly met: boolean;
  readonly label: string;
}

/** O3: icon + text, never colour alone — applies to the live VR-02 checklist same as any other status. */
function Criterion({ met, label }: CriterionProps): JSX.Element {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: met ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
      <Icon name={met ? 'check' : 'chevron-right'} aria-hidden="true" />
      <span>{label}</span>
    </li>
  );
}

/**
 * P-08 · Set new password (FRONTEND.md, API §1.8). On success, routes to
 * P-06 without a session — the handler deliberately never issues one
 * (NFR-SEC-08-adjacent: a reset proves control of the mailbox, not
 * identity strong enough to skip sign-in).
 */
export function ConfirmResetPage(): JSX.Element {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const token = search.token;

  const [newPassword, setNewPassword] = useState('');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const complexity = evaluatePasswordComplexity(newPassword);

  async function handleSubmit(): Promise<void> {
    if (token === undefined) return;
    setFormError(undefined);
    setTokenInvalid(false);
    setSubmitting(true);
    try {
      await confirmPasswordReset(token, newPassword);
      await navigate({ to: '/sign-in' });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RESET_TOKEN_INVALID') {
        setTokenInvalid(true);
        setFormError(error.message);
      } else {
        setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (token === undefined) {
    return (
      <AuthCard title="Choose a new password">
        <Banner tone="danger" message="This link is missing its reset token. Request a new one." />
        <p style={{ marginTop: 'var(--space-3)' }}>
          <Link to="/reset-password">Request a new reset link</Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      {formError !== undefined && <Banner tone="danger" message={formError} />}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: formError === undefined ? 0 : 'var(--space-2)' }}
      >
        <Input label="New password" type="password" value={newPassword} onChange={setNewPassword} required autoComplete="new-password" />

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-0-5)', fontSize: 'var(--text-sm)' }}>
          <Criterion met={complexity.meetsMinimumLength} label="At least 10 characters" />
          <Criterion met={complexity.hasLowercase} label="A lowercase letter" />
          <Criterion met={complexity.hasUppercase} label="An uppercase letter" />
          <Criterion met={complexity.hasDigit} label="A digit" />
          <Criterion met={complexity.hasSymbol} label="A symbol" />
        </ul>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          Meet at least three of the four above.
        </p>

        <Button
          variant="primary"
          type="submit"
          loading={submitting}
          disabled={!complexity.satisfiesPolicy}
          {...(complexity.satisfiesPolicy ? {} : { disabledReason: 'Meet the password requirements above first' })}
        >
          Save password
        </Button>
      </form>

      {tokenInvalid && (
        <p style={{ marginTop: 'var(--space-3)' }}>
          <Link to="/reset-password">Request a new reset link</Link>
        </p>
      )}
    </AuthCard>
  );
}
