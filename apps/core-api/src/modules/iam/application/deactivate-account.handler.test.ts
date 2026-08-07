import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';

import type { AccountAdminRepository, AccountDetail, ActiveAppointmentSummary } from './account-admin-repository.js';
import { DeactivateAccountHandler } from './deactivate-account.handler.js';

const NOW = new Date('2026-08-03T14:35:00+06:00');
const REASON = 'Student graduated at the end of Spring 2026';

const STUDENT_ACCOUNT: AccountDetail = {
  userId: 'user-3',
  email: 'student@diu.edu.bd',
  fullName: 'Nusrat Jahan',
  status: 'active',
  authMethod: 'sso',
  roles: [{ code: 'STU', grantedBy: 'user-3', grantedAt: NOW }],
  studentProfile: { studentRef: '221-15-5678', programme: 'BSc in CSE', isEnrolled: true },
  lockedUntil: null,
  lastLoginAt: null,
  isClinicalStaff: false,
  version: 5,
};

function buildHandler(overrides: { readonly repository?: Partial<AccountAdminRepository> } = {}) {
  const repository: AccountAdminRepository = {
    listAccounts: vi.fn(),
    findAccountDetailById: vi.fn().mockResolvedValue(STUDENT_ACCOUNT),
    isEmailRegistered: vi.fn(),
    createAccount: vi.fn(),
    updateAccountAdmin: vi.fn(),
    transitionStatus: vi.fn().mockResolvedValue({ outcome: 'transitioned', account: { ...STUDENT_ACCOUNT, status: 'deactivated', version: 6 } }),
    findActiveAppointmentsForStudent: vi.fn().mockResolvedValue([]),
    ...overrides.repository,
  };
  const sessionStore = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) } as unknown as SessionStore;
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new DeactivateAccountHandler(repository, sessionStore, auditRecorder, clock);
  return { handler, repository, sessionStore, auditRecorder };
}

const BASE_INPUT = { userId: 'user-3', reason: REASON, confirmedImpact: false, expectedVersion: 5, actorId: 'admin-1', correlationId: 'corr-1' };

describe('DeactivateAccountHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an already-deactivated account', async () => {
    const { handler, repository } = buildHandler({
      repository: { findAccountDetailById: vi.fn().mockResolvedValue({ ...STUDENT_ACCOUNT, status: 'deactivated' }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect(repository.findActiveAppointmentsForStudent).not.toHaveBeenCalled();
  });

  it('succeeds with no confirmation when there are no active bookings — the honest-empty M1 path', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cancelledAppointments).toEqual([]);
  });

  it('VR-05: requires confirmedImpact when active bookings exist, listing them in details', async () => {
    const activeAppointments: ActiveAppointmentSummary[] = [
      { appointmentRef: 'MED-2026-0081', sessionDate: '2026-08-05', doctorName: 'Dr. Rahman' },
    ];
    const { handler, repository } = buildHandler({
      repository: { findActiveAppointmentsForStudent: vi.fn().mockResolvedValue(activeAppointments) },
    });

    const result = await handler.execute(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFIRMATION_REQUIRED');
      expect(result.error.details?.activeAppointments).toEqual(activeAppointments);
    }
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

  it('proceeds when confirmedImpact is true despite active bookings, returning them as cancelled', async () => {
    const activeAppointments: ActiveAppointmentSummary[] = [
      { appointmentRef: 'MED-2026-0081', sessionDate: '2026-08-05', doctorName: 'Dr. Rahman' },
    ];
    const { handler, sessionStore, auditRecorder } = buildHandler({
      repository: { findActiveAppointmentsForStudent: vi.fn().mockResolvedValue(activeAppointments) },
    });

    const result = await handler.execute({ ...BASE_INPUT, confirmedImpact: true });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cancelledAppointments).toEqual(activeAppointments);
    expect(sessionStore.revokeAllForUser).toHaveBeenCalledWith('user-3');
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'deactivated' }));
  });
});
