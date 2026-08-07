import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';
import { UpdateAccountAdminHandler } from './update-account-admin.handler.js';

const NOW = new Date('2026-08-03T14:35:00+06:00');

const ACCOUNT: AccountDetail = {
  userId: 'user-2',
  email: 'dr.rahman@diu.edu.bd',
  fullName: 'Dr. Rahman',
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
    findAccountDetailById: vi.fn().mockResolvedValue(ACCOUNT),
    isEmailRegistered: vi.fn(),
    createAccount: vi.fn(),
    updateAccountAdmin: vi.fn().mockResolvedValue({ outcome: 'updated', account: { ...ACCOUNT, fullName: 'Dr. M. Rahman', version: 3 } }),
    transitionStatus: vi.fn(),
    findActiveAppointmentsForStudent: vi.fn(),
    listRoleCatalogue: vi.fn(),
    grantRole: vi.fn(),
    revokeRole: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new UpdateAccountAdminHandler(repository, auditRecorder, clock);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { userId: 'user-2', fullName: 'Dr. M. Rahman', isClinicalStaff: undefined, locationId: undefined, expectedVersion: 2, actorId: 'admin-1', correlationId: 'corr-1' };

describe('UpdateAccountAdminHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a whitespace-only fullName', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, fullName: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.updateAccountAdmin).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for an unknown account', async () => {
    const { handler } = buildHandler({ repository: { updateAccountAdmin: vi.fn().mockResolvedValue({ outcome: 'not_found' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
    }
  });

  it('returns CONFLICT_STALE_VERSION with the current account in details', async () => {
    const { handler } = buildHandler({ repository: { updateAccountAdmin: vi.fn().mockResolvedValue({ outcome: 'stale' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details?.current).toMatchObject({ userId: 'user-2', version: 2 });
    }
  });

  it('on success: audits the change and returns the updated account', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ fullName: 'Dr. M. Rahman', version: 3 });
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'identity.user_account', action: 'admin_updated', actorId: 'admin-1' }),
    );
  });
});
