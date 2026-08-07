import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import type { PasswordHasher } from '../infrastructure/password-hasher.js';
import { PasswordResetTokenGenerator } from '../infrastructure/password-reset-token-generator.js';

import type { AccountAdminRepository, AccountDetail, CreateAccountResult } from './account-admin-repository.js';
import { CreateAccountHandler } from './create-account.handler.js';
import type { PasswordResetRepository } from './password-reset-repository.js';

const NOW = new Date('2026-08-03T14:35:00+06:00');

const CREATED_ACCOUNT: AccountDetail = {
  userId: 'user-2',
  email: 'dr.rahman@diu.edu.bd',
  fullName: 'Dr. Rahman',
  status: 'pending',
  authMethod: 'local',
  roles: [{ code: 'MCS', grantedBy: 'admin-1', grantedAt: NOW }],
  studentProfile: null,
  lockedUntil: null,
  lastLoginAt: null,
  isClinicalStaff: false,
  version: 1,
};

function buildHandler(overrides: { readonly repository?: Partial<AccountAdminRepository> } = {}) {
  const repository: AccountAdminRepository = {
    listAccounts: vi.fn(),
    findAccountDetailById: vi.fn(),
    isEmailRegistered: vi.fn().mockResolvedValue(false),
    createAccount: vi.fn().mockResolvedValue({ outcome: 'created', account: CREATED_ACCOUNT } satisfies CreateAccountResult),
    updateAccountAdmin: vi.fn(),
    transitionStatus: vi.fn(),
    findActiveAppointmentsForStudent: vi.fn(),
    listRoleCatalogue: vi.fn(),
    grantRole: vi.fn(),
    revokeRole: vi.fn(),
    ...overrides.repository,
  };

  const passwordHasher = { hash: vi.fn().mockResolvedValue('placeholder-hash'), verify: vi.fn() } as unknown as PasswordHasher;
  const resetRepository: PasswordResetRepository = {
    createToken: vi.fn().mockResolvedValue(undefined),
    findValidToken: vi.fn(),
    consumeToken: vi.fn(),
    updatePasswordHash: vi.fn(),
  };
  const tokenGenerator = new PasswordResetTokenGenerator();
  const policyStore = { getRequiredInteger: vi.fn().mockResolvedValue(30) } as unknown as PolicyStore;
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined), recordDenial: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const enqueueNotification = vi.fn().mockResolvedValue(undefined);
  const clock: Clock = { now: () => NOW };

  const handler = new CreateAccountHandler(
    repository,
    passwordHasher,
    resetRepository,
    tokenGenerator,
    policyStore,
    auditRecorder,
    enqueueNotification,
    'http://localhost:5173',
    clock,
  );

  return { handler, repository, resetRepository, auditRecorder, enqueueNotification };
}

const BASE_INPUT = {
  email: 'dr.rahman@diu.edu.bd',
  fullName: 'Dr. Rahman',
  authMethod: 'local' as const,
  roles: ['MCS'] as const,
  isClinicalStaff: false,
  locationId: null,
  createdBy: 'admin-1',
  correlationId: 'corr-1',
};

describe('CreateAccountHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-DIU email — VR-01', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, email: 'dr.rahman@gmail.com' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects STU as a requested role — self-registration only happens via SSO', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, roles: ['STU'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROLE_NOT_ASSIGNABLE');
    expect(auditRecorder.recordDenial).not.toHaveBeenCalled();
  });

  it('rejects an empty roles array', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, roles: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('rejects CNP without isClinicalStaff, and logs it as a security event — VR-04', async () => {
    const { handler, auditRecorder, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, roles: ['CNP'], isClinicalStaff: false });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROLE_NOT_ASSIGNABLE');
    expect(auditRecorder.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'user-accounts-and-roles', reason: 'ROLE_NOT_ASSIGNABLE' }),
    );
    expect(repository.createAccount).not.toHaveBeenCalled();
  });

  it('allows CNP when isClinicalStaff is true', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, roles: ['CNP'], isClinicalStaff: true });
    expect(result.ok).toBe(true);
    expect(repository.createAccount).toHaveBeenCalled();
  });

  it('rejects a duplicate email with EMAIL_ALREADY_REGISTERED', async () => {
    const { handler } = buildHandler({ repository: { isEmailRegistered: vi.fn().mockResolvedValue(true) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('for authMethod local: hashes a random placeholder password, creates a reset token, and enqueues the first-use email', async () => {
    const { handler, repository, resetRepository, enqueueNotification } = buildHandler();
    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(true);
    expect(repository.createAccount).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: 'placeholder-hash' }));
    expect(resetRepository.createToken).toHaveBeenCalledWith(expect.objectContaining({ userAccountId: CREATED_ACCOUNT.userId }));
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: CREATED_ACCOUNT.userId, templateKey: 'password_reset_requested' }),
    );
  });

  it('for authMethod sso: no password hash, no reset token, no email', async () => {
    const { handler, repository, resetRepository, enqueueNotification } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, authMethod: 'sso' });

    expect(result.ok).toBe(true);
    expect(repository.createAccount).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: null }));
    expect(resetRepository.createToken).not.toHaveBeenCalled();
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it('audits the creation on success', async () => {
    const { handler, auditRecorder } = buildHandler();
    await handler.execute(BASE_INPUT);
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'identity.user_account', action: 'created', actorId: 'admin-1' }),
    );
  });
});
