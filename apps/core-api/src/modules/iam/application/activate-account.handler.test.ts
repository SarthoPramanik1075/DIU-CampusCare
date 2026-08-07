import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';
import { ActivateAccountHandler } from './activate-account.handler.js';

const NOW = new Date('2026-08-03T14:35:00+06:00');
const REASON = 'Enrolment confirmed by the registrar';

const SUSPENDED_ACCOUNT: AccountDetail = {
  userId: 'user-3',
  email: 'student@diu.edu.bd',
  fullName: 'Nusrat Jahan',
  status: 'suspended',
  authMethod: 'sso',
  roles: [{ code: 'STU', grantedBy: 'user-3', grantedAt: NOW }],
  studentProfile: null,
  lockedUntil: null,
  lastLoginAt: null,
  isClinicalStaff: false,
  version: 5,
};

function buildHandler(overrides: { readonly repository?: Partial<AccountAdminRepository> } = {}) {
  const repository: AccountAdminRepository = {
    listAccounts: vi.fn(),
    findAccountDetailById: vi.fn().mockResolvedValue(SUSPENDED_ACCOUNT),
    isEmailRegistered: vi.fn(),
    createAccount: vi.fn(),
    updateAccountAdmin: vi.fn(),
    transitionStatus: vi.fn().mockResolvedValue({ outcome: 'transitioned', account: { ...SUSPENDED_ACCOUNT, status: 'active', version: 6 } }),
    findActiveAppointmentsForStudent: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new ActivateAccountHandler(repository, auditRecorder, clock);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { userId: 'user-3', reason: REASON, expectedVersion: 5, actorId: 'admin-1', correlationId: 'corr-1' };

describe('ActivateAccountHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an already-active account — INVALID_STATUS_TRANSITION', async () => {
    const { handler, repository } = buildHandler({
      repository: { findAccountDetailById: vi.fn().mockResolvedValue({ ...SUSPENDED_ACCOUNT, status: 'active' }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

  it('permits reactivating a deactivated account, auditing it distinctly', async () => {
    const { handler, auditRecorder, repository } = buildHandler({
      repository: {
        findAccountDetailById: vi.fn().mockResolvedValue({ ...SUSPENDED_ACCOUNT, status: 'deactivated' }),
      },
    });
    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    expect(repository.transitionStatus).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'active' }));
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'reactivated_from_deactivated' }));
  });

  it('on success from suspended: audits as "activated" and returns the active account', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('active');
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'activated' }));
  });
});
