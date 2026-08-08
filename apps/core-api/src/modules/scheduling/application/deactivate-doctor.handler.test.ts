import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import { DeactivateDoctorHandler } from './deactivate-doctor.handler.js';
import type { DoctorDetail, DoctorRepository } from './doctor-repository.js';

const ACTIVE_DOCTOR: DoctorDetail = {
  doctorId: 'doctor-1',
  userAccountId: null,
  fullName: 'Dr. Rahman',
  designation: null,
  specialisation: null,
  photoUrl: null,
  isActive: true,
  activeRosterCount: 2,
  upcomingSessionCount: 4,
  version: 2,
};

function buildHandler(overrides: { readonly repository?: Partial<DoctorRepository> } = {}) {
  const repository: DoctorRepository = {
    findDefaultLocationId: vi.fn(),
    listDoctors: vi.fn(),
    findDoctorDetailById: vi.fn().mockResolvedValue(ACTIVE_DOCTOR),
    isUserAccountLinked: vi.fn(),
    createDoctor: vi.fn(),
    updateDoctor: vi.fn(),
    deactivateDoctor: vi
      .fn()
      .mockResolvedValue({ outcome: 'deactivated', doctor: { ...ACTIVE_DOCTOR, isActive: false, version: 3 }, affectedUpcomingSessions: 4 }),
    countAppointmentHistory: vi.fn(),
    deleteDoctor: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const handler = new DeactivateDoctorHandler(repository, auditRecorder);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { doctorId: 'doctor-1', reason: 'Left the medical centre at the end of July', expectedVersion: 2, actorId: 'admin-1', correlationId: 'corr-1' };

describe('DeactivateDoctorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a reason under 10 characters — VR-93', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.findDoctorDetailById).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown doctor', async () => {
    const { handler } = buildHandler({ repository: { findDoctorDetailById: vi.fn().mockResolvedValue(null) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('rejects deactivating an already-inactive doctor — ALREADY_INACTIVE', async () => {
    const { handler, repository } = buildHandler({ repository: { findDoctorDetailById: vi.fn().mockResolvedValue({ ...ACTIVE_DOCTOR, isActive: false }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ALREADY_INACTIVE');
    expect(repository.deactivateDoctor).not.toHaveBeenCalled();
  });

  it('does not cancel upcoming sessions — only reports the count', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.doctor.isActive).toBe(false);
      expect(result.value.affectedUpcomingSessions).toBe(4);
    }
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'deactivated', afterState: { reason: BASE_INPUT.reason } }));
  });

  it('returns CONFLICT_STALE_VERSION on a stale write', async () => {
    const { handler } = buildHandler({ repository: { deactivateDoctor: vi.fn().mockResolvedValue({ outcome: 'stale' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
  });
});
