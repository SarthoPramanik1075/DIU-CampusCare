import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';
import { RevokeRoleHandler } from './revoke-role.handler.js';

const NOW = new Date('2026-08-03T14:35:00+06:00');

const ACCOUNT: AccountDetail = {
  userId: 'user-2',
  email: 'reception@diu.edu.bd',
  fullName: 'Reception Staff',
  status: 'active',
  authMethod: 'local',
  roles: [{ code: 'MCS', grantedBy: 'admin-1', grantedAt: NOW }],
  studentProfile: null,
  lockedUntil: null,
  lastLoginAt: null,
  isClinicalStaff: false,
  version: 2,
};

function buildHandler(overrides: { readonly repository?: Partial<AccountAdminRepository> } = {}) {
  const repository: AccountAdminRepository = {
    listAccounts: vi.fn(),
    findAccountDetailById: vi.fn(),
    isEmailRegistered: vi.fn(),
    createAccount: vi.fn(),
    updateAccountAdmin: vi.fn(),
    transitionStatus: vi.fn(),
    findActiveAppointmentsForStudent: vi.fn(),
    listRoleCatalogue: vi.fn(),
    grantRole: vi.fn(),
    revokeRole: vi.fn().mockResolvedValue({ outcome: 'revoked', account: { ...ACCOUNT, roles: [] } }),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new RevokeRoleHandler(repository, auditRecorder, clock);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { userId: 'user-2', roleCode: 'MCS' as const, reason: 'Transferred out of the medical centre', actorId: 'admin-1', correlationId: 'corr-1' };

describe('RevokeRoleHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a reason under 10 characters — VR-93', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.revokeRole).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown account', async () => {
    const { handler } = buildHandler({ repository: { revokeRole: vi.fn().mockResolvedValue({ outcome: 'not_found' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns ROLE_NOT_HELD (404) when the account does not hold the role', async () => {
    const { handler } = buildHandler({ repository: { revokeRole: vi.fn().mockResolvedValue({ outcome: 'not_held' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ROLE_NOT_HELD');
      expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
    }
  });

  it('returns LAST_ADMIN_ROLE (409) when the repository reports it', async () => {
    const { handler } = buildHandler({ repository: { revokeRole: vi.fn().mockResolvedValue({ outcome: 'would_remove_last_admin' }) } });
    const result = await handler.execute({ ...BASE_INPUT, roleCode: 'ADM' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LAST_ADMIN_ROLE');
  });

  it('on success: passes the clock reading through, audits the revocation, and returns the updated account', async () => {
    const { handler, repository, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.roles).toEqual([]);
    expect(repository.revokeRole).toHaveBeenCalledWith({ userId: 'user-2', roleCode: 'MCS', now: NOW });
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'identity.user_role', action: 'revoked', actorId: 'admin-1' }),
    );
  });
});
