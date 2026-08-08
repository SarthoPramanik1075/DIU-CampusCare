import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import { CreateDoctorHandler } from './create-doctor.handler.js';
import type { DoctorDetail, DoctorRepository } from './doctor-repository.js';

const CREATED_DOCTOR: DoctorDetail = {
  doctorId: 'doctor-1',
  userAccountId: null,
  fullName: 'Dr. Rahman',
  designation: 'Consultant',
  specialisation: 'General Medicine',
  photoUrl: null,
  isActive: true,
  activeRosterCount: 0,
  upcomingSessionCount: 0,
  version: 1,
};

function buildHandler(overrides: { readonly repository?: Partial<DoctorRepository> } = {}) {
  const repository: DoctorRepository = {
    findDefaultLocationId: vi.fn().mockResolvedValue('location-1'),
    listDoctors: vi.fn(),
    findDoctorDetailById: vi.fn(),
    isUserAccountLinked: vi.fn().mockResolvedValue(false),
    createDoctor: vi.fn().mockResolvedValue({ outcome: 'created', doctor: CREATED_DOCTOR }),
    updateDoctor: vi.fn(),
    deactivateDoctor: vi.fn(),
    countAppointmentHistory: vi.fn(),
    deleteDoctor: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const handler = new CreateDoctorHandler(repository, auditRecorder);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = {
  fullName: 'Dr. Rahman',
  designation: 'Consultant',
  specialisation: 'General Medicine',
  photoUrl: null,
  userAccountId: null,
  locationId: 'location-1',
  actorId: 'admin-1',
  correlationId: 'corr-1',
};

describe('CreateDoctorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an empty full name', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, fullName: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.createDoctor).not.toHaveBeenCalled();
  });

  it('refuses a userAccountId already linked to another doctor — ACCOUNT_ALREADY_LINKED', async () => {
    const { handler, repository } = buildHandler({ repository: { isUserAccountLinked: vi.fn().mockResolvedValue(true) } });
    const result = await handler.execute({ ...BASE_INPUT, userAccountId: 'account-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ACCOUNT_ALREADY_LINKED');
    expect(repository.createDoctor).not.toHaveBeenCalled();
  });

  it('surfaces a race-condition ACCOUNT_ALREADY_LINKED reported by the repository itself', async () => {
    const { handler } = buildHandler({ repository: { createDoctor: vi.fn().mockResolvedValue({ outcome: 'account_already_linked' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ACCOUNT_ALREADY_LINKED');
  });

  it('resolves the default location when none is given', async () => {
    const { handler, repository } = buildHandler();
    await handler.execute({ ...BASE_INPUT, locationId: undefined });
    expect(repository.findDefaultLocationId).toHaveBeenCalled();
    expect(repository.createDoctor).toHaveBeenCalledWith(expect.objectContaining({ locationId: 'location-1' }));
  });

  it('on success: audits and returns the created doctor', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(CREATED_DOCTOR);
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created', entityType: 'scheduling.doctor' }));
  });
});
