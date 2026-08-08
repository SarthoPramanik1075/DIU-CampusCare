import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import { CancelSessionHandler } from './cancel-session.handler.js';
import type { AffectedAppointment, ClinicSessionListItem, ClinicSessionRepository } from './clinic-session-repository.js';

const SESSION: ClinicSessionListItem = {
  sessionId: 'session-1',
  doctorId: 'doctor-1',
  doctorName: 'Dr. Rahman',
  locationId: 'location-1',
  sessionDate: '2026-08-10',
  startsAt: new Date('2026-08-10T09:00:00Z'),
  endsAt: new Date('2026-08-10T13:00:00Z'),
  slotLengthMinutes: 10,
  walkInAllocationPct: 30,
  totalSlotCount: 24,
  bookableSlotCount: 16,
  bookedSlotCount: 14,
  status: 'scheduled',
  nextSerial: 1,
  actuallyStartedAt: null,
  actuallyEndedAt: null,
  changeReason: null,
  isOverride: true,
  version: 2,
};

const OPEN: readonly AffectedAppointment[] = [
  { appointmentId: 'apt-1', appointmentRef: 'MED-2026-0001', studentId: 'student-1', serialNumber: 1 },
  { appointmentId: 'apt-2', appointmentRef: 'MED-2026-0002', studentId: null, serialNumber: 2 },
];

function buildHandler(overrides: { readonly repository?: Partial<ClinicSessionRepository> } = {}) {
  const repository: ClinicSessionRepository = {
    listClinicSessions: vi.fn(),
    findClinicSessionById: vi.fn().mockResolvedValue(SESSION),
    findDoctorLocationId: vi.fn(),
    findServiceCalendarClosure: vi.fn(),
    countBookedAppointments: vi.fn(),
    createClinicSession: vi.fn(),
    updateClinicSession: vi.fn(),
    listSessionSlots: vi.fn(),
    getQueueSummary: vi.fn(),
    listOpenAppointments: vi.fn().mockResolvedValue(OPEN),
    startSession: vi.fn(),
    interruptSession: vi.fn(),
    countInConsultation: vi.fn(),
    completeSession: vi.fn(),
    cancelSession: vi.fn().mockResolvedValue({ outcome: 'cancelled', session: { ...SESSION, status: 'cancelled', version: 3 }, cancelledAppointments: OPEN }),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const enqueueNotification = vi.fn().mockResolvedValue(undefined);
  const handler = new CancelSessionHandler(repository, auditRecorder, enqueueNotification);
  return { handler, repository, auditRecorder, enqueueNotification };
}

const BASE_INPUT = { sessionId: 'session-1', reason: 'Doctor called to an emergency at the main campus', confirmedImpact: true, expectedVersion: 2, actorId: 'mcs-1', correlationId: 'corr-1' };

describe('CancelSessionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a reason under 10 characters — VR-93', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.findClinicSessionById).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown session', async () => {
    const { handler } = buildHandler({ repository: { findClinicSessionById: vi.fn().mockResolvedValue(null) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns INVALID_STATUS_TRANSITION when the session already ended', async () => {
    const { handler } = buildHandler({ repository: { findClinicSessionById: vi.fn().mockResolvedValue({ ...SESSION, status: 'completed' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns CONFIRMATION_REQUIRED with the affected list when confirmedImpact is not true, without mutating anything', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, confirmedImpact: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFIRMATION_REQUIRED');
      expect(result.error.details).toEqual({ affectedAppointments: OPEN });
    }
    expect(repository.cancelSession).not.toHaveBeenCalled();
  });

  it('returns CONFLICT_STALE_VERSION with the current representation', async () => {
    const { handler } = buildHandler({ repository: { cancelSession: vi.fn().mockResolvedValue({ outcome: 'stale' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details).toEqual({ current: SESSION });
    }
  });

  it('on success: notifies only appointments with a real student id, audits with the reason, reports counts', async () => {
    const { handler, auditRecorder, enqueueNotification } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ sessionId: 'session-1', status: 'cancelled', cancelledAppointments: 2, notificationsQueued: 1, version: 3 });
    }
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'student-1', templateKey: 'session_cancelled', channel: 'in_app' }));
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'cancelled', afterState: { reason: BASE_INPUT.reason } }));
  });
});
