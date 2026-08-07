import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';
import { SuspendAccountHandler } from './suspend-account.handler.js';

const NOW = new Date('2026-08-03T14:35:00+06:00');
const REASON = 'Enrolment under review by the registrar';

const ACTIVE_ACCOUNT: AccountDetail = {
  userId: 'user-3',
  email: 'student@diu.edu.bd',
  fullName: 'Nusrat Jahan',
  status: 'active',
  authMethod: 'sso',
  roles: [{ code: 'STU', grantedBy: 'user-3', grantedAt: NOW }],
  studentProfile: null,
  lockedUntil: null,
  lastLoginAt: null,
  isClinicalStaff: false,
  version: 4,
};

function buildHandler(overrides: { readonly repository?: Partial<AccountAdminRepository> } = {}) {
  const repository: AccountAdminRepository = {
    listAccounts: vi.fn(),
    findAccountDetailById: vi.fn().mockResolvedValue(ACTIVE_ACCOUNT),
    isEmailRegistered: vi.fn(),
    createAccount: vi.fn(),
    updateAccountAdmin: vi.fn(),
    transitionStatus: vi.fn().mockResolvedValue({ outcome: 'transitioned', account: { ...ACTIVE_ACCOUNT, status: 'suspended', version: 5 } }),
    findActiveAppointmentsForStudent: vi.fn(),
    listRoleCatalogue: vi.fn(),
    grantRole: vi.fn(),
    revokeRole: vi.fn(),
    ...overrides.repository,
  };
  const sessionStore = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) } as unknown as SessionStore;
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new SuspendAccountHandler(repository, sessionStore, auditRecorder, clock);
  return { handler, repository, sessionStore, auditRecorder };
}

const BASE_INPUT = { userId: 'user-3', reason: REASON, expectedVersion: 4, actorId: 'admin-1', correlationId: 'corr-1' };

describe('SuspendAccountHandler', () => {
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

  it('returns 404 for an unknown account', async () => {
    const { handler } = buildHandler({ repository: { findAccountDetailById: vi.fn().mockResolvedValue(null) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('rejects suspending an already-deactivated account — INVALID_STATUS_TRANSITION, accurate message', async () => {
    const { handler, repository } = buildHandler({
      repository: { findAccountDetailById: vi.fn().mockResolvedValue({ ...ACTIVE_ACCOUNT, status: 'deactivated' }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_STATUS_TRANSITION');
      expect(result.error.message).toBe('This account is already deactivated.');
    }
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

  it('rejects suspending an already-suspended account with its own accurate message, not the deactivated one', async () => {
    const { handler, repository } = buildHandler({
      repository: { findAccountDetailById: vi.fn().mockResolvedValue({ ...ACTIVE_ACCOUNT, status: 'suspended' }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_STATUS_TRANSITION');
      expect(result.error.message).toBe('This account is already suspended.');
    }
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

  it('on success: revokes every session, audits, and returns the suspended account', async () => {
    const { handler, sessionStore, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('suspended');
    expect(sessionStore.revokeAllForUser).toHaveBeenCalledWith('user-3');
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'suspended', actorId: 'admin-1' }));
  });

  it('allows suspending a pending account — API §1.3', async () => {
    const { handler } = buildHandler({
      repository: { findAccountDetailById: vi.fn().mockResolvedValue({ ...ACTIVE_ACCOUNT, status: 'pending' }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
  });
});
