import { describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../../kernel/audit/audit-recorder.js';
import type { AccountAdminRepository, AccountDetail } from '../account-admin-repository.js';

import { GetAccountDetailQuery } from './get-account-detail.query.js';

const ACCOUNT: AccountDetail = {
  userId: 'user-3',
  email: 'student@diu.edu.bd',
  fullName: 'Nusrat Jahan',
  status: 'active',
  authMethod: 'sso',
  roles: [{ code: 'STU', grantedBy: 'user-3', grantedAt: new Date('2026-01-14T09:12:00+06:00') }],
  studentProfile: null,
  lockedUntil: null,
  lastLoginAt: null,
  isClinicalStaff: false,
  version: 4,
};

function buildQuery(overrides: { readonly repository?: Partial<AccountAdminRepository> } = {}) {
  const repository: AccountAdminRepository = {
    listAccounts: vi.fn(),
    findAccountDetailById: vi.fn().mockResolvedValue(ACCOUNT),
    isEmailRegistered: vi.fn(),
    createAccount: vi.fn(),
    updateAccountAdmin: vi.fn(),
    transitionStatus: vi.fn(),
    findActiveAppointmentsForStudent: vi.fn(),
    listRoleCatalogue: vi.fn(),
    grantRole: vi.fn(),
    revokeRole: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordDataAccess: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  return { query: new GetAccountDetailQuery(repository, auditRecorder), repository, auditRecorder };
}

describe('GetAccountDetailQuery', () => {
  it('returns null and records no access for an unknown account', async () => {
    const { query, auditRecorder } = buildQuery({ repository: { findAccountDetailById: vi.fn().mockResolvedValue(null) } });
    const result = await query.execute({ userId: 'unknown', accessorId: 'admin-1', correlationId: 'corr-1' });
    expect(result).toBeNull();
    expect(auditRecorder.recordDataAccess).not.toHaveBeenCalled();
  });

  it('returns the account and records FR-AUD-03 data access', async () => {
    const { query, auditRecorder } = buildQuery();
    const result = await query.execute({ userId: 'user-3', accessorId: 'admin-1', correlationId: 'corr-1' });

    expect(result).toEqual(ACCOUNT);
    expect(auditRecorder.recordDataAccess).toHaveBeenCalledWith({
      accessorId: 'admin-1',
      subjectId: 'user-3',
      dataCategory: 'identity.user_account',
      correlationId: 'corr-1',
    });
  });
});
