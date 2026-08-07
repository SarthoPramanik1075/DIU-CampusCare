import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';
import type { PasswordHasher } from '../infrastructure/password-hasher.js';
import { PasswordResetTokenGenerator } from '../infrastructure/password-reset-token-generator.js';

import { ConfirmPasswordResetHandler } from './confirm-password-reset.handler.js';
import type { PasswordResetRepository, ValidResetToken } from './password-reset-repository.js';

const NOW = new Date('2026-08-03T14:35:00+06:00');
const VALID_TOKEN: ValidResetToken = { id: 'token-1', userAccountId: 'user-1' };
const STRONG_PASSWORD = 'New correct horse battery 2!';

function buildHandler(overrides: {
  readonly resetRepository?: Partial<PasswordResetRepository>;
} = {}) {
  const resetRepository: PasswordResetRepository = {
    createToken: vi.fn(),
    findValidToken: vi.fn().mockResolvedValue(VALID_TOKEN),
    consumeToken: vi.fn().mockResolvedValue(undefined),
    updatePasswordHash: vi.fn().mockResolvedValue(undefined),
    ...overrides.resetRepository,
  };

  const tokenGenerator = new PasswordResetTokenGenerator();
  const passwordHasher = { hash: vi.fn().mockResolvedValue('new-hash'), verify: vi.fn() } as unknown as PasswordHasher;
  const sessionStore = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) } as unknown as SessionStore;
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };

  const handler = new ConfirmPasswordResetHandler(resetRepository, tokenGenerator, passwordHasher, sessionStore, auditRecorder, clock);

  return { handler, resetRepository, passwordHasher, sessionStore, auditRecorder };
}

const BASE_INPUT = { token: 'raw-token', newPassword: STRONG_PASSWORD, correlationId: 'corr-1' };

describe('ConfirmPasswordResetHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a weak password with itemized VALIDATION_FAILED fields — VR-02, before even checking the token', async () => {
    const { handler, resetRepository } = buildHandler();

    const result = await handler.execute({ ...BASE_INPUT, newPassword: 'weak' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.fields?.length).toBeGreaterThan(0);
    }
    expect(resetRepository.findValidToken).not.toHaveBeenCalled();
  });

  it('rejects an unknown, expired, or consumed token with RESET_TOKEN_INVALID', async () => {
    const { handler } = buildHandler({ resetRepository: { findValidToken: vi.fn().mockResolvedValue(null) } });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('on success: hashes the new password, consumes the token, revokes every session, audits, and never issues a session', async () => {
    const { handler, resetRepository, passwordHasher, sessionStore, auditRecorder } = buildHandler();

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('value.sessionId');
    expect(passwordHasher.hash).toHaveBeenCalledWith(STRONG_PASSWORD);
    expect(resetRepository.updatePasswordHash).toHaveBeenCalledWith(VALID_TOKEN.userAccountId, 'new-hash', NOW);
    expect(resetRepository.consumeToken).toHaveBeenCalledWith(VALID_TOKEN.id, NOW);
    expect(sessionStore.revokeAllForUser).toHaveBeenCalledWith(VALID_TOKEN.userAccountId);
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'identity.local_credential',
        action: 'password_reset',
        actorId: VALID_TOKEN.userAccountId,
      }),
    );
  });
});
