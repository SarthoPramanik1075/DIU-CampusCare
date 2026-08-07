import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import type { CsrfTokenService } from '../../../kernel/identity/csrf.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import type { PasswordHasher } from '../infrastructure/password-hasher.js';

import type { AccountWithCredential, AuthenticationRepository } from './authentication-repository.js';
import { LoginWithPasswordHandler } from './login-with-password.handler.js';
import { SessionIssuer } from './session-issuer.js';

const NOW = new Date('2026-08-03T14:35:00+06:00');

const ACTIVE_ACCOUNT: AccountWithCredential = {
  id: 'user-1',
  email: 'student@diu.edu.bd',
  fullName: 'Nusrat Jahan',
  status: 'active',
  version: 1,
  passwordHash: 'stored-hash',
  failedAttempts: 0,
  lockedUntil: null,
};

function buildHandler(overrides: {
  readonly repository?: Partial<AuthenticationRepository>;
  readonly passwordHasher?: Partial<PasswordHasher>;
  readonly policyStore?: Partial<PolicyStore>;
} = {}) {
  const repository: AuthenticationRepository = {
    findAccountWithCredentialByEmail: vi.fn().mockResolvedValue(ACTIVE_ACCOUNT),
    findAccountById: vi.fn(),
    loadActiveRoleCodes: vi.fn().mockResolvedValue(['STU']),
    recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
    resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
    recordLoginAttempt: vi.fn().mockResolvedValue(undefined),
    findOrProvisionBySsoSubject: vi.fn(),
    ...overrides.repository,
  };

  const passwordHasher: PasswordHasher = {
    hash: vi.fn().mockResolvedValue('dummy-hash'),
    verify: vi.fn().mockResolvedValue(true),
    ...overrides.passwordHasher,
  };

  const sessionStore = {
    create: vi.fn().mockResolvedValue({
      id: 'session-1',
      userAccountId: ACTIVE_ACCOUNT.id,
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      lastSeenAt: NOW,
      clientFingerprint: null,
    }),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionStore;

  const csrfTokenService = { issue: vi.fn().mockReturnValue('csrf-token-1') } as unknown as CsrfTokenService;

  const policyStore: PolicyStore = {
    getRequiredInteger: vi.fn().mockImplementation((key: string) => {
      const values: Record<string, number> = {
        'auth.lockout.maxAttempts': 5,
        'auth.lockout.durationMinutes': 15,
        'auth.session.idleTimeoutMinutes.student': 30,
        'auth.session.idleTimeoutMinutes.staff': 15,
      };
      return Promise.resolve(values[key]);
    }),
    ...overrides.policyStore,
  } as unknown as PolicyStore;

  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const enqueueNotification = vi.fn().mockResolvedValue(undefined);
  const clock: Clock = { now: () => NOW };
  const sessionIssuer = new SessionIssuer(repository, sessionStore, csrfTokenService, policyStore);

  const handler = new LoginWithPasswordHandler(
    repository,
    passwordHasher,
    sessionIssuer,
    policyStore,
    auditRecorder,
    enqueueNotification,
    clock,
  );

  return { handler, repository, passwordHasher, sessionStore, csrfTokenService, policyStore, auditRecorder, enqueueNotification };
}

const BASE_INPUT = {
  email: 'student@diu.edu.bd',
  password: 'correct horse battery staple',
  sourceAddress: '127.0.0.1',
  correlationId: 'corr-1',
};

describe('LoginWithPasswordHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-DIU email with VALIDATION_FAILED — VR-01', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, email: 'student@gmail.com' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns the generic INVALID_CREDENTIALS for an unknown account, and still hashes for timing parity', async () => {
    const { handler, passwordHasher, repository } = buildHandler({
      repository: { findAccountWithCredentialByEmail: vi.fn().mockResolvedValue(null) },
    });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_CREDENTIALS');
    expect(passwordHasher.hash).toHaveBeenCalled();
    expect(passwordHasher.verify).toHaveBeenCalled();
    expect(repository.recordLoginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ userAccountId: null, succeeded: false }),
    );
  });

  it('returns ACCOUNT_LOCKED (423) with unlockAt when the account is currently locked', async () => {
    const lockedUntil = new Date(NOW.getTime() + 5 * 60_000);
    const { handler, passwordHasher } = buildHandler({
      repository: {
        findAccountWithCredentialByEmail: vi.fn().mockResolvedValue({ ...ACTIVE_ACCOUNT, lockedUntil }),
      },
    });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNT_LOCKED');
      expect((result.error as { httpStatus: number }).httpStatus).toBe(423);
    }
    // Locked-out means the password is never even checked.
    expect(passwordHasher.verify).not.toHaveBeenCalled();
  });

  it('increments failed_attempts on a wrong password without locking below the threshold', async () => {
    const { handler, repository, passwordHasher } = buildHandler({
      passwordHasher: { verify: vi.fn().mockResolvedValue(false) },
    });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_CREDENTIALS');
    expect(repository.recordFailedAttempt).toHaveBeenCalledWith(ACTIVE_ACCOUNT.id, null);
    expect(passwordHasher.verify).toHaveBeenCalledTimes(1);
  });

  it('locks the account and enqueues an email notice on the 5th consecutive failure — FR-AUTH-14', async () => {
    const { handler, repository, enqueueNotification } = buildHandler({
      repository: {
        findAccountWithCredentialByEmail: vi.fn().mockResolvedValue({ ...ACTIVE_ACCOUNT, failedAttempts: 4 }),
      },
      passwordHasher: { verify: vi.fn().mockResolvedValue(false) },
    });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ACCOUNT_LOCKED');
    expect(repository.recordFailedAttempt).toHaveBeenCalledWith(ACTIVE_ACCOUNT.id, expect.any(Date));
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: ACTIVE_ACCOUNT.id, templateKey: 'account_locked', channel: 'email' }),
    );
  });

  it('returns ACCOUNT_NOT_ACTIVE for a correct password on a non-active account, and still resets the counter', async () => {
    const { handler, repository } = buildHandler({
      repository: {
        findAccountWithCredentialByEmail: vi.fn().mockResolvedValue({ ...ACTIVE_ACCOUNT, status: 'pending' }),
      },
    });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNT_NOT_ACTIVE');
      expect((result.error as { httpStatus: number }).httpStatus).toBe(403);
    }
    expect(repository.resetFailedAttempts).toHaveBeenCalledWith(ACTIVE_ACCOUNT.id);
  });

  it('succeeds for a correct password on an active account: revokes prior sessions, issues a new one, resets the counter, audits', async () => {
    const { handler, repository, sessionStore, csrfTokenService, auditRecorder } = buildHandler();

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        userId: ACTIVE_ACCOUNT.id,
        fullName: ACTIVE_ACCOUNT.fullName,
        roles: ['STU'],
        sessionId: 'session-1',
        csrfToken: 'csrf-token-1',
        idleTimeoutMinutes: 30,
      });
    }
    expect(sessionStore.revokeAllForUser).toHaveBeenCalledWith(ACTIVE_ACCOUNT.id);
    expect(sessionStore.create).toHaveBeenCalledWith({ userAccountId: ACTIVE_ACCOUNT.id, idleTimeoutMs: 30 * 60_000 });
    expect(csrfTokenService.issue).toHaveBeenCalledWith('session-1');
    expect(repository.resetFailedAttempts).toHaveBeenCalledWith(ACTIVE_ACCOUNT.id);
    expect(repository.recordLoginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ userAccountId: ACTIVE_ACCOUNT.id, succeeded: true }),
    );
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login', actorId: ACTIVE_ACCOUNT.id }),
    );
  });

  it('applies the 15-minute staff tier when the account holds any non-STU role', async () => {
    const { handler, sessionStore } = buildHandler({
      repository: { loadActiveRoleCodes: vi.fn().mockResolvedValue(['STU', 'MCS']) },
    });

    await handler.execute(BASE_INPUT);

    expect(sessionStore.create).toHaveBeenCalledWith({
      userAccountId: ACTIVE_ACCOUNT.id,
      idleTimeoutMs: 15 * 60_000,
    });
  });
});
