import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import { DeleteDoctorHandler } from './delete-doctor.handler.js';
import type { DoctorRepository } from './doctor-repository.js';

function buildHandler(overrides: { readonly repository?: Partial<DoctorRepository> } = {}) {
  const repository: DoctorRepository = {
    findDefaultLocationId: vi.fn(),
    listDoctors: vi.fn(),
    findDoctorDetailById: vi.fn(),
    isUserAccountLinked: vi.fn(),
    createDoctor: vi.fn(),
    updateDoctor: vi.fn(),
    deactivateDoctor: vi.fn(),
    countAppointmentHistory: vi.fn().mockResolvedValue(0),
    deleteDoctor: vi.fn().mockResolvedValue({ outcome: 'deleted' }),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const handler = new DeleteDoctorHandler(repository, auditRecorder);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { doctorId: 'doctor-1', actorId: 'admin-1', correlationId: 'corr-1' };

describe('DeleteDoctorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses deletion with appointment history — DOCTOR_HAS_HISTORY, names the count', async () => {
    const { handler, repository } = buildHandler({ repository: { countAppointmentHistory: vi.fn().mockResolvedValue(214) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DOCTOR_HAS_HISTORY');
      expect(result.error.details).toEqual({ affectedRecords: 214 });
      expect(result.error.message).toContain('214 appointment records');
    }
    expect(repository.deleteDoctor).not.toHaveBeenCalled();
  });

  it('singular wording for exactly one appointment record', async () => {
    const { handler } = buildHandler({ repository: { countAppointmentHistory: vi.fn().mockResolvedValue(1) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('1 appointment record and');
  });

  it('returns 404 for an unknown doctor', async () => {
    const { handler } = buildHandler({ repository: { deleteDoctor: vi.fn().mockResolvedValue({ outcome: 'not_found' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('on success with zero history: deletes and audits', async () => {
    const { handler, repository, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    expect(repository.deleteDoctor).toHaveBeenCalledWith('doctor-1');
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted', entityType: 'scheduling.doctor' }));
  });
});
