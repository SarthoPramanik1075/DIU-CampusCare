import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';

import { ConfirmUnavailabilityHandler } from './confirm-unavailability.handler.js';
import type { AffectedAppointmentDetail, ImpactAnalysis, PreviewRecord, UnavailabilityRepository } from './unavailability-repository.js';

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

const WALKIN_APPOINTMENT: AffectedAppointmentDetail = { ...APPOINTMENT, appointmentId: 'apt-2', studentId: null, studentRef: null, studentName: null, requiresRefundFlag: false, paymentStatus: 'unpaid' };

const IMPACT: ImpactAnalysis = { affectedSessions: 3, affectedAppointments: [APPOINTMENT, WALKIN_APPOINTMENT], alternativeAvailability: [] };

const PREVIEW: PreviewRecord = {
  previewToken: 'preview-1',
  doctorId: 'doctor-1',
  startDate: '2026-08-20',
  endDate: '2026-08-24',
  reason: 'Annual leave approved by the medical director',
  affectedAppointmentIds: ['apt-1', 'apt-2'],
  expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
};

function buildHandler(overrides: { readonly repository?: Partial<UnavailabilityRepository> } = {}) {
  const repository: UnavailabilityRepository = {
    doctorExists: vi.fn().mockResolvedValue(true),
    findOverlappingUnavailability: vi.fn().mockResolvedValue(null),
    computeImpact: vi.fn().mockResolvedValue(IMPACT),
    createPreview: vi.fn(),
    findPreview: vi.fn().mockResolvedValue(PREVIEW),
    createUnavailability: vi.fn().mockResolvedValue({ outcome: 'created', unavailabilityId: 'unavail-1', cancelledAppointmentIds: ['apt-1', 'apt-2'] }),
    listUnavailability: vi.fn(),
    findUnavailabilityById: vi.fn(),
    deleteUnavailability: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined), recordDataAccess: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const enqueueNotification = vi.fn().mockResolvedValue(undefined);
  const handler = new ConfirmUnavailabilityHandler(repository, auditRecorder, clock, enqueueNotification);
  return { handler, repository, auditRecorder, enqueueNotification };
}

const BASE_INPUT = {
  doctorId: 'doctor-1',
  previewToken: 'preview-1',
  startDate: '2026-08-20',
  endDate: '2026-08-24',
  reason: 'Annual leave approved by the medical director',
  actorId: 'mcs-1',
  correlationId: 'corr-1',
};

describe('ConfirmUnavailabilityHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects endDate before startDate — VR-16', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, startDate: '2026-08-24', endDate: '2026-08-20' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
    expect(repository.findPreview).not.toHaveBeenCalled();
  });

  it('rejects a reason under 10 characters — VR-93', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 when the doctor does not exist', async () => {
    const { handler } = buildHandler({ repository: { doctorExists: vi.fn().mockResolvedValue(false) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns PREVIEW_REQUIRED when the token is missing/expired', async () => {
    const { handler, repository } = buildHandler({ repository: { findPreview: vi.fn().mockResolvedValue(null) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PREVIEW_REQUIRED');
    expect(repository.createUnavailability).not.toHaveBeenCalled();
  });

  it('returns PREVIEW_REQUIRED when the submitted dates/reason do not match the preview', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: 'A completely different reason for leave here' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PREVIEW_REQUIRED');
  });

  it('returns UNAVAILABILITY_OVERLAP when a period was recorded after the preview', async () => {
    const { handler } = buildHandler({
      repository: { findOverlappingUnavailability: vi.fn().mockResolvedValue({ unavailabilityId: 'u-1', doctorId: 'doctor-1', startDate: '2026-08-19', endDate: '2026-08-21', reason: 'x', createdBy: 'mcs-1', createdAt: NOW }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNAVAILABILITY_OVERLAP');
  });

  it('returns IMPACT_CHANGED when the affected set grew since the preview', async () => {
    const { handler, repository } = buildHandler({
      repository: { computeImpact: vi.fn().mockResolvedValue({ ...IMPACT, affectedAppointments: [...IMPACT.affectedAppointments, { ...APPOINTMENT, appointmentId: 'apt-3' }] }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('IMPACT_CHANGED');
      expect(result.error.details).toEqual({ newAffectedCount: 3 });
    }
    expect(repository.createUnavailability).not.toHaveBeenCalled();
  });

  it('returns IMPACT_CHANGED when the affected set shrank since the preview (a cancellation in the meantime)', async () => {
    const { handler } = buildHandler({ repository: { computeImpact: vi.fn().mockResolvedValue({ ...IMPACT, affectedAppointments: [APPOINTMENT] }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('IMPACT_CHANGED');
  });

  it('on success: notifies only appointments with a real student id, audits, reports counts and refund flags', async () => {
    const { handler, auditRecorder, enqueueNotification, repository } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        unavailabilityId: 'unavail-1',
        startDate: '2026-08-20',
        endDate: '2026-08-24',
        cancelledAppointments: 2,
        notificationsQueued: 1,
        notificationDeadline: new Date(NOW.getTime() + 5 * 60 * 1000),
        paymentsFlaggedForRefund: 1,
      });
    }
    expect(repository.createUnavailability).toHaveBeenCalledWith('doctor-1', '2026-08-20', '2026-08-24', BASE_INPUT.reason, ['apt-1', 'apt-2'], 'mcs-1');
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'student-1', templateKey: 'doctor_unavailability_cancelled', channel: 'in_app' }));
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created', entityType: 'scheduling.doctor_unavailability', entityId: 'unavail-1' }));
  });
});
