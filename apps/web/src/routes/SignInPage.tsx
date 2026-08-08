import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { ssoLoginUrl } from '../features/auth/api.js';
import { useLogin } from '../features/auth/use-session.js';
import { ApiError } from '../infrastructure/api-client.js';
import { AuthCard } from '../shared/AuthCard.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button } from '../shared/primitives/Button.js';
import { Input } from '../shared/primitives/Input.js';

/**
 * P-06 · Sign in (FRONTEND.md). SSO is the primary path; there is no
 * endpoint to ask "is SSO configured" ahead of time (API.md defines none),
 * so availability is discovered by actually starting the round trip with
 * `redirect: 'manual'` — a same-origin `503 SSO_UNAVAILABLE` is then a
 * readable JSON body rather than a followed redirect, disabling the button
 * in place with the required explanation (API §1.1) instead of sending the
 * browser to a raw JSON error page.
 */
export function SignInPage(): JSX.Element {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const redirectTo = search.redirectTo;
  const login = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [ssoError, setSsoError] = useState<string | undefined>(undefined);
  const [ssoChecking, setSsoChecking] = useState(false);

  async function handleSsoClick(): Promise<void> {
    setSsoChecking(true);
    setSsoError(undefined);
    const url = ssoLoginUrl(redirectTo);
    try {
      const response = await fetch(url, { credentials: 'include', redirect: 'manual' });
      if (response.type === 'opaqueredirect') {
        window.location.href = url;
        return;
      }
      const body: unknown = await response.json().catch(() => undefined);
      const message =
        typeof body === 'object' && body !== null && 'error' in body && typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
          ? (body as { error: { message: string } }).error.message
          : "Sign-in with your DIU account isn't available right now. You can sign in with your email and password instead.";
      setSsoError(message);
    } catch {
      setSsoError("Sign-in with your DIU account isn't available right now. You can sign in with your email and password instead.");
    } finally {
      setSsoChecking(false);
    }
  }

  async function handlePasswordSubmit(): Promise<void> {
    setFormError(undefined);
    try {
      await login.mutateAsync({ email, password });
      await navigate({ to: redirectTo ?? '/' });
    } catch (error) {
      // API §1.3: INVALID_CREDENTIALS, ACCOUNT_LOCKED and ACCOUNT_NOT_ACTIVE
      // all arrive with a complete, already-worded `message` (the 423 case
      // includes the real unlock time) — shown verbatim, never re-derived.
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <AuthCard title="Sign in">
      {ssoError !== undefined && <Banner tone="warning" message={ssoError} />}

      <div style={{ marginTop: ssoError === undefined ? 0 : 'var(--space-2)' }}>
        <Button variant="primary" size="lg" loading={ssoChecking} onClick={() => void handleSsoClick()}>
          Sign in with DIU account
        </Button>
      </div>

      <p role="separator" style={{ textAlign: 'center', color: 'var(--color-text-secondary)', margin: 'var(--space-3) 0' }}>
        — or —
      </p>

      {formError !== undefined && <Banner tone="danger" message={formError} />}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handlePasswordSubmit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: formError === undefined ? 0 : 'var(--space-2)' }}
      >
        <Input label="University email" type="email" value={email} onChange={setEmail} required autoComplete="username" />
        <Input label="Password" type="password" value={password} onChange={setPassword} required autoComplete="current-password" />
        <Button variant="primary" type="submit" loading={login.isPending}>
          Sign in
        </Button>
      </form>

      <p style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
        <Link to="/reset-password">Forgot your password?</Link>
      </p>
    </AuthCard>
  );
}
