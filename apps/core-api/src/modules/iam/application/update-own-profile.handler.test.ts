import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';

import type { AuthenticationRepository } from './authentication-repository.js';
import type { OwnProfileAccount, OwnProfileRepository } from './own-profile-repository.js';
import { UpdateOwnProfileHandler } from './update-own-profile.handler.js';

const NOW = new Date('2026-08-03T14:35:00+06:00');

const ACCOUNT: OwnProfileAccount = {
  id: 'user-1',
  email: 'student@diu.edu.bd',
  fullName: 'Nusrat Jahan',
  status: 'active',
  version: 4,
  authMethod: 'local',
};

function buildHandler(overrides: { readonly repository?: Partial<OwnProfileRepository> } = {}) {
  const repository: OwnProfileRepository = {
    findAccountById: vi.fn().mockResolvedValue(ACCOUNT),
    findStudentProfile: vi.fn().mockResolvedValue(null),
    updateFullName: vi
      .fn()
      .mockResolvedValue({ outcome: 'updated', account: { ...ACCOUNT, fullName: 'Nusrat Jahan Mim', version: 5 } }),
    ...overrides.repository,
  };
  const authRepository: Pick<AuthenticationRepository, 'loadActiveRoleCodes'> = {
    loadActiveRoleCodes: vi.fn().mockResolvedValue(['STU']),
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };

  const handler = new UpdateOwnProfileHandler(repository, authRepository, auditRecorder, clock);
  return { handler, repository, authRepository, auditRecorder, clock };
}

const BASE_INPUT = { userAccountId: 'user-1', fullName: 'Nusrat Jahan Mim', expectedVersion: 4, correlationId: 'corr-1' };

describe('UpdateOwnProfileHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a whitespace-only fullName with VALIDATION_FAILED', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, fullName: '   ' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.updateFullName).not.toHaveBeenCalled();
  });

  it('trims fullName before writing it', async () => {
    const { handler, repository, clock } = buildHandler();
    await handler.execute({ ...BASE_INPUT, fullName: '  Nusrat Jahan Mim  ' });

    expect(repository.updateFullName).toHaveBeenCalledWith({
      userAccountId: 'user-1',
      fullName: 'Nusrat Jahan Mim',
      expectedVersion: 4,
      now: clock.now(),
    });
  });

  it('allows an undefined fullName — a version-only no-op update', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, fullName: undefined });

    expect(result.ok).toBe(true);
    expect(repository.updateFullName).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: undefined }),
    );
  });

  it('on success: audits the change and returns the assembled profile', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ userId: 'user-1', fullName: 'Nusrat Jahan Mim', version: 5, roles: ['STU'] });
    }
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'identity.user_account', action: 'profile_updated', actorId: 'user-1' }),
    );
  });

  it('on a stale version: returns CONFLICT_STALE_VERSION with the current profile in details, and does not audit', async () => {
    const { handler, repository, auditRecorder } = buildHandler({
      repository: { updateFullName: vi.fn().mockResolvedValue({ outcome: 'stale' }) },
    });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details?.current).toMatchObject({ userId: 'user-1', version: 4 });
    }
    expect(auditRecorder.recordChange).not.toHaveBeenCalled();
    expect(repository.findAccountById).toHaveBeenCalledWith('user-1');
  });
});
