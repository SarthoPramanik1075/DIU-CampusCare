import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { CsrfTokenService } from '../../../kernel/identity/csrf.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';

import type { AccountSummary, AuthenticationRepository } from './authentication-repository.js';
import { SessionIssuer } from './session-issuer.js';
import { SsoCallbackHandler } from './sso-callback.handler.js';
import type { SsoClient, SsoIdentity } from './sso-client.js';

const IDENTITY: SsoIdentity = { subject: 'idp-subject-1', email: 'nusrat@diu.edu.bd', fullName: 'Nusrat Jahan' };
const ACCOUNT: AccountSummary = {
  id: 'user-1',
  email: IDENTITY.email,
  fullName: IDENTITY.fullName,
  status: 'active',
  version: 1,
};

function buildHandler(overrides: {
  readonly ssoClient?: Partial<SsoClient>;
  readonly repository?: Partial<AuthenticationRepository>;
} = {}) {
  const ssoClient: SsoClient = {
    isConfigured: true,
    createAuthorizationRequest: vi.fn(),
    completeLogin: vi.fn().mockResolvedValue(IDENTITY),
    ...overrides.ssoClient,
  };

  const repository: AuthenticationRepository = {
    findAccountWithCredentialByEmail: vi.fn(),
    findAccountById: vi.fn(),
    loadActiveRoleCodes: vi.fn().mockResolvedValue(['STU']),
    recordFailedAttempt: vi.fn(),
    resetFailedAttempts: vi.fn(),
    recordLoginAttempt: vi.fn().mockResolvedValue(undefined),
    findOrProvisionBySsoSubject: vi.fn().mockResolvedValue(ACCOUNT),
    ...overrides.repository,
  };

  const sessionStore = {
    create: vi.fn().mockResolvedValue({
      id: 'session-1',
      userAccountId: ACCOUNT.id,
      issuedAt: new Date(),
      expiresAt: new Date(),
      lastSeenAt: new Date(),
      clientFingerprint: null,
    }),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionStore;
  const csrfTokenService = { issue: vi.fn().mockReturnValue('csrf-token-1') } as unknown as CsrfTokenService;
  const policyStore = { getRequiredInteger: vi.fn().mockResolvedValue(30) } as unknown as PolicyStore;
  const sessionIssuer = new SessionIssuer(repository, sessionStore, csrfTokenService, policyStore);
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;

  const handler = new SsoCallbackHandler(ssoClient, repository, sessionIssuer, auditRecorder);
  return { handler, ssoClient, repository, auditRecorder };
}

const BASE_INPUT = {
  callbackUrl: new URL('http://localhost:3001/api/v1/auth/sso/callback?code=abc&state=xyz'),
  queryState: 'xyz',
  preSessionState: 'xyz',
  codeVerifier: 'verifier-1',
  correlationId: 'corr-1',
};

describe('SsoCallbackHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects with SSO_STATE_MISMATCH when the query state does not match the pre-session', async () => {
    const { handler, ssoClient } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, queryState: 'different' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SSO_STATE_MISMATCH');
      expect((result.error as { httpStatus: number }).httpStatus).toBe(403);
    }
    expect(ssoClient.completeLogin).not.toHaveBeenCalled();
  });

  it('rejects with SSO_STATE_MISMATCH when the query has no state at all', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, queryState: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SSO_STATE_MISMATCH');
  });

  it('maps a failed code exchange to SSO_EXCHANGE_FAILED (503), never leaking the underlying cause', async () => {
    const { handler } = buildHandler({
      ssoClient: { completeLogin: vi.fn().mockRejectedValue(new Error('network reset by peer')) },
    });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SSO_EXCHANGE_FAILED');
      expect(result.error.message).not.toContain('network reset');
    }
  });

  it('provisions a new account on first successful SSO and issues a session', async () => {
    const { handler, repository } = buildHandler();

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    expect(repository.findOrProvisionBySsoSubject).toHaveBeenCalledWith(IDENTITY);
    if (result.ok) {
      expect(result.value.userId).toBe(ACCOUNT.id);
      expect(result.value.roles).toEqual(['STU']);
    }
  });

  it('rejects with ACCOUNT_NOT_ACTIVE when the resolved account is not active', async () => {
    const { handler } = buildHandler({
      repository: { findOrProvisionBySsoSubject: vi.fn().mockResolvedValue({ ...ACCOUNT, status: 'suspended' }) },
    });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNT_NOT_ACTIVE');
      expect((result.error as { httpStatus: number }).httpStatus).toBe(403);
    }
  });

  it('records the login attempt and an audit entry on success', async () => {
    const { handler, repository, auditRecorder } = buildHandler();

    await handler.execute(BASE_INPUT);

    expect(repository.recordLoginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ emailAttempted: IDENTITY.email, userAccountId: ACCOUNT.id, succeeded: true }),
    );
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login', actorId: ACCOUNT.id }),
    );
  });
});
