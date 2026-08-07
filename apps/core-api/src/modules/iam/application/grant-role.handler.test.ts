import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';
import { GrantRoleHandler } from './grant-role.handler.js';

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
    findAccountDetailById: vi.fn().mockResolvedValue(ACCOUNT),
    isEmailRegistered: vi.fn(),
    createAccount: vi.fn(),
    updateAccountAdmin: vi.fn(),
    transitionStatus: vi.fn(),
    findActiveAppointmentsForStudent: vi.fn(),
    listRoleCatalogue: vi.fn(),
    grantRole: vi.fn().mockResolvedValue({ outcome: 'granted', account: { ...ACCOUNT, roles: [...ACCOUNT.roles, { code: 'STO', grantedBy: 'admin-1', grantedAt: NOW }] } }),
    revokeRole: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined), recordDenial: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const handler = new GrantRoleHandler(repository, auditRecorder);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { userId: 'user-2', roleCode: 'STO' as const, reason: 'Joined medical centre reception on 1 August', actorId: 'admin-1', correlationId: 'corr-1' };

describe('GrantRoleHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a reason under 10 characters — VR-93', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.findAccountDetailById).not.toHaveBeenCalled();
  });

  it('rejects STU — student accounts are provisioned by SSO', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, roleCode: 'STU' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROLE_NOT_ASSIGNABLE');
    expect(repository.findAccountDetailById).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown account', async () => {
    const { handler } = buildHandler({ repository: { findAccountDetailById: vi.fn().mockResolvedValue(null) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('rejects CNP without isClinicalStaff and logs a security event — VR-04', async () => {
    const { handler, repository, auditRecorder } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, roleCode: 'CNP' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROLE_NOT_ASSIGNABLE');
    expect(auditRecorder.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'user-accounts-and-roles', reason: 'ROLE_NOT_ASSIGNABLE' }),
    );
    expect(repository.grantRole).not.toHaveBeenCalled();
  });

  it('allows CNP when the account is flagged clinical staff', async () => {
    const { handler, repository } = buildHandler({
      repository: { findAccountDetailById: vi.fn().mockResolvedValue({ ...ACCOUNT, isClinicalStaff: true }) },
    });
    const result = await handler.execute({ ...BASE_INPUT, roleCode: 'CNP' });
    expect(result.ok).toBe(true);
    expect(repository.grantRole).toHaveBeenCalled();
  });

  it('returns ROLE_ALREADY_HELD (409) when the repository reports it', async () => {
    const { handler } = buildHandler({ repository: { grantRole: vi.fn().mockResolvedValue({ outcome: 'already_held' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROLE_ALREADY_HELD');
  });

  it('on success: audits the grant and returns the updated account', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.roles.map((r) => r.code)).toContain('STO');
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'identity.user_role', action: 'granted', actorId: 'admin-1' }),
    );
  });
});
