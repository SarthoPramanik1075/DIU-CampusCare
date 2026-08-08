import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import type { DoctorDetail, DoctorRepository } from './doctor-repository.js';
import { UpdateDoctorHandler } from './update-doctor.handler.js';

const DOCTOR: DoctorDetail = {
  doctorId: 'doctor-1',
  userAccountId: null,
  fullName: 'Dr. Rahman',
  designation: 'Consultant',
  specialisation: 'General Medicine',
  photoUrl: null,
  isActive: true,
  activeRosterCount: 0,
  upcomingSessionCount: 0,
  version: 3,
};

function buildHandler(overrides: { readonly repository?: Partial<DoctorRepository> } = {}) {
  const repository: DoctorRepository = {
    findDefaultLocationId: vi.fn(),
    listDoctors: vi.fn(),
    findDoctorDetailById: vi.fn().mockResolvedValue(DOCTOR),
    isUserAccountLinked: vi.fn(),
    createDoctor: vi.fn(),
    updateDoctor: vi.fn().mockResolvedValue({ outcome: 'updated', doctor: { ...DOCTOR, designation: 'Senior Consultant', version: 4 } }),
    deactivateDoctor: vi.fn(),
    countAppointmentHistory: vi.fn(),
    deleteDoctor: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const handler = new UpdateDoctorHandler(repository, auditRecorder);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = {
  doctorId: 'doctor-1',
  fullName: undefined,
  designation: 'Senior Consultant',
  specialisation: undefined,
  photoUrl: undefined,
  expectedVersion: 3,
  actorId: 'admin-1',
  correlationId: 'corr-1',
};

describe('UpdateDoctorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a full name that is only whitespace', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, fullName: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.updateDoctor).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown doctor', async () => {
    const { handler } = buildHandler({ repository: { updateDoctor: vi.fn().mockResolvedValue({ outcome: 'not_found' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns CONFLICT_STALE_VERSION with the current representation on a stale write', async () => {
    const { handler } = buildHandler({ repository: { updateDoctor: vi.fn().mockResolvedValue({ outcome: 'stale' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details).toEqual({ current: DOCTOR });
    }
  });

  it('on success: audits and returns the updated doctor', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.designation).toBe('Senior Consultant');
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'updated', entityId: 'doctor-1' }));
  });
});
