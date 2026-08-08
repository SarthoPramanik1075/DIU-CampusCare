import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';

import { PreviewUnavailabilityHandler } from './preview-unavailability.handler.js';
import type { AffectedAppointmentDetail, ImpactAnalysis, UnavailabilityRepository } from './unavailability-repository.js';

const NOW = new Date('2026-08-01T00:00:00Z');

const APPOINTMENT: AffectedAppointmentDetail = {
  appointmentId: 'apt-1',
  appointmentRef: 'MED-2026-0081',
  studentId: 'student-1',
  studentRef: '221-15-5678',
  studentName: 'Nusrat Jahan',
  sessionDate: '2026-08-20',
  serialNumber: 7,
  paymentStatus: 'paid',
  requiresRefundFlag: true,
};

const IMPACT: ImpactAnalysis = {
  affectedSessions: 3,
  affectedAppointments: [APPOINTMENT],
  alternativeAvailability: [{ doctorName: 'Dr. Chowdhury', sessionDate: '2026-08-20', remainingSlots: 6 }],
};

function buildHandler(overrides: { readonly repository?: Partial<UnavailabilityRepository> } = {}) {
  const repository: UnavailabilityRepository = {
    doctorExists: vi.fn().mockResolvedValue(true),
    findOverlappingUnavailability: vi.fn().mockResolvedValue(null),
    computeImpact: vi.fn().mockResolvedValue(IMPACT),
    createPreview: vi.fn().mockResolvedValue({ previewToken: 'preview-1' }),
    findPreview: vi.fn(),
    createUnavailability: vi.fn(),
    listUnavailability: vi.fn(),
    findUnavailabilityById: vi.fn(),
    deleteUnavailability: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordDataAccess: vi.fn().mockResolvedValue(undefined), recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new PreviewUnavailabilityHandler(repository, auditRecorder, clock);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { doctorId: 'doctor-1', startDate: '2026-08-20', endDate: '2026-08-24', reason: 'Annual leave approved by the medical director', actorId: 'mcs-1', correlationId: 'corr-1' };

describe('PreviewUnavailabilityHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects endDate before startDate — VR-16 (INVALID_DATE_RANGE)', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, startDate: '2026-08-24', endDate: '2026-08-20' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
    expect(repository.doctorExists).not.toHaveBeenCalled();
  });

  it('rejects a period entirely in the past — VR-16', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, startDate: '2020-01-01', endDate: '2020-01-05' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('rejects a reason under 10 characters — VR-93', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 when the doctor does not exist', async () => {
    const { handler, repository } = buildHandler({ repository: { doctorExists: vi.fn().mockResolvedValue(false) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
    expect(repository.computeImpact).not.toHaveBeenCalled();
  });

  it('returns UNAVAILABILITY_OVERLAP when an existing period overlaps', async () => {
    const { handler } = buildHandler({
      repository: { findOverlappingUnavailability: vi.fn().mockResolvedValue({ unavailabilityId: 'u-1', doctorId: 'doctor-1', startDate: '2026-08-19', endDate: '2026-08-21', reason: 'x', createdBy: 'mcs-1', createdAt: NOW }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNAVAILABILITY_OVERLAP');
  });

  it('on success: writes no unavailability row, records data access per distinct student, returns the public shape', async () => {
    const { handler, repository, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.previewToken).toBe('preview-1');
      expect(result.value.affectedSessions).toBe(3);
      expect(result.value.affectedAppointments).toEqual([
        { appointmentRef: 'MED-2026-0081', studentRef: '221-15-5678', studentName: 'Nusrat Jahan', sessionDate: '2026-08-20', serialNumber: 7, paymentStatus: 'paid', requiresRefundFlag: true },
      ]);
      expect(result.value.alternativeAvailability).toEqual(IMPACT.alternativeAvailability);
      expect(result.value.expiresAt.getTime()).toBe(NOW.getTime() + 15 * 60 * 1000);
    }
    expect(repository.createUnavailability).not.toHaveBeenCalled();
    expect(auditRecorder.recordDataAccess).toHaveBeenCalledTimes(1);
    expect(auditRecorder.recordDataAccess).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'student-1', dataCategory: 'queueing.appointment' }));
  });
});
