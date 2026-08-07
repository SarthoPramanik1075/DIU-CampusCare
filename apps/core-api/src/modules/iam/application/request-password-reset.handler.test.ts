import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { PasswordResetTokenGenerator } from '../infrastructure/password-reset-token-generator.js';

import type { AccountWithCredential, AuthenticationRepository } from './authentication-repository.js';
import type { PasswordResetRepository } from './password-reset-repository.js';
import { RequestPasswordResetHandler } from './request-password-reset.handler.js';

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
  readonly authRepository?: Partial<Pick<AuthenticationRepository, 'findAccountWithCredentialByEmail'>>;
} = {}) {
  const authRepository: Pick<AuthenticationRepository, 'findAccountWithCredentialByEmail'> = {
    findAccountWithCredentialByEmail: vi.fn().mockResolvedValue(ACTIVE_ACCOUNT),
    ...overrides.authRepository,
  };

  const resetRepository: PasswordResetRepository = {
    createToken: vi.fn().mockResolvedValue(undefined),
    findValidToken: vi.fn(),
    consumeToken: vi.fn(),
    updatePasswordHash: vi.fn(),
  };

  const tokenGenerator = new PasswordResetTokenGenerator();
  const policyStore = {
    getRequiredInteger: vi.fn().mockResolvedValue(30),
  } as unknown as PolicyStore;
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const enqueueNotification = vi.fn().mockResolvedValue(undefined);
  const clock: Clock = { now: () => NOW };

  const handler = new RequestPasswordResetHandler(
    authRepository,
    resetRepository,
    tokenGenerator,
    policyStore,
    auditRecorder,
    enqueueNotification,
    'http://localhost:5173',
    clock,
  );

  return { handler, authRepository, resetRepository, policyStore, auditRecorder, enqueueNotification };
}

const BASE_INPUT = { email: 'student@diu.edu.bd', correlationId: 'corr-1' };

describe('RequestPasswordResetHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-DIU email with VALIDATION_FAILED — VR-01', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, email: 'student@gmail.com' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns ok with no side effects for an unknown account — API §0.4 uniform response', async () => {
    const { handler, resetRepository, enqueueNotification, auditRecorder } = buildHandler({
      authRepository: { findAccountWithCredentialByEmail: vi.fn().mockResolvedValue(null) },
    });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    expect(resetRepository.createToken).not.toHaveBeenCalled();
    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(auditRecorder.recordChange).not.toHaveBeenCalled();
  });

  it('creates a token, audits, and enqueues the reset email for a real account', async () => {
    const { handler, resetRepository, enqueueNotification, auditRecorder } = buildHandler();

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    expect(resetRepository.createToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userAccountId: ACTIVE_ACCOUNT.id,
        expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      }),
    );
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'identity.password_reset_token', action: 'requested', actorId: ACTIVE_ACCOUNT.id }),
    );
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: ACTIVE_ACCOUNT.id,
        templateKey: 'password_reset_requested',
        channel: 'email',
        payload: expect.objectContaining({
          resetLink: expect.stringContaining('http://localhost:5173/reset-password/confirm?token='),
        }),
      }),
    );
  });
});
