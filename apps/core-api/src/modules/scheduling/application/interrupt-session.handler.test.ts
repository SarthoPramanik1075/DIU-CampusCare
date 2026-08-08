import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import type { AffectedAppointment, ClinicSessionListItem, ClinicSessionRepository } from './clinic-session-repository.js';
import { InterruptSessionHandler } from './interrupt-session.handler.js';

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
  bookedSlotCount: 3,
  status: 'interrupted',
  nextSerial: 4,
  actuallyStartedAt: new Date('2026-08-10T09:05:00Z'),
  actuallyEndedAt: null,
  changeReason: 'Doctor called to an emergency in the hostel block',
  isOverride: true,
  version: 3,
};

const REMAINING: readonly AffectedAppointment[] = [
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
    listOpenAppointments: vi.fn(),
    startSession: vi.fn(),
    interruptSession: vi.fn().mockResolvedValue({ outcome: 'interrupted', session: SESSION, remainingAppointments: REMAINING }),
    countInConsultation: vi.fn(),
    completeSession: vi.fn(),
    cancelSession: vi.fn(),    findDefaultLocationId: vi.fn(),    listPublicAvailability: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const enqueueNotification = vi.fn().mockResolvedValue(undefined);
  const handler = new InterruptSessionHandler(repository, auditRecorder, enqueueNotification);
  return { handler, repository, auditRecorder, enqueueNotification };
}

const BASE_INPUT = { sessionId: 'session-1', reason: 'Doctor called to an emergency in the hostel block', expectedVersion: 2, actorId: 'mcs-1', correlationId: 'corr-1' };

describe('InterruptSessionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a reason under 10 characters — VR-93', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.interruptSession).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown session', async () => {
    const { handler } = buildHandler({ repository: { interruptSession: vi.fn().mockResolvedValue({ outcome: 'not_found' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns INVALID_STATUS_TRANSITION when the session is not started', async () => {
    const { handler } = buildHandler({ repository: { interruptSession: vi.fn().mockResolvedValue({ outcome: 'invalid_transition' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns CONFLICT_STALE_VERSION with the current representation', async () => {
    const { handler } = buildHandler({ repository: { interruptSession: vi.fn().mockResolvedValue({ outcome: 'stale' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details).toEqual({ current: SESSION });
    }
  });

  it('on success: notifies only appointments with a real student id, reports the full remaining count, audits', async () => {
    const { handler, auditRecorder, enqueueNotification } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ sessionId: 'session-1', status: 'interrupted', remainingPatients: 2, notificationsQueued: 1, version: 3 });
    }
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'student-1', templateKey: 'session_interrupted', channel: 'in_app' }));
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'interrupted', entityId: 'session-1' }));
  });
});
