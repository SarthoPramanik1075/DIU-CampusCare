import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';

import type { AffectedAppointment, ClinicSessionListItem, ClinicSessionRepository } from './clinic-session-repository.js';
import { CompleteSessionHandler } from './complete-session.handler.js';

const NOW = new Date('2026-08-10T13:24:00Z');

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
  bookedSlotCount: 0,
  status: 'completed',
  nextSerial: 15,
  actuallyStartedAt: new Date('2026-08-10T09:05:00Z'),
  actuallyEndedAt: NOW,
  changeReason: null,
  isOverride: true,
  version: 5,
};

const EXPIRED: readonly AffectedAppointment[] = [{ appointmentId: 'apt-1', appointmentRef: 'MED-2026-0001', studentId: 'student-1', serialNumber: 15 }];

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
    interruptSession: vi.fn(),
    countInConsultation: vi.fn(),
    completeSession: vi.fn().mockResolvedValue({ outcome: 'completed', session: SESSION, expiredAppointments: EXPIRED }),
    cancelSession: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const enqueueNotification = vi.fn().mockResolvedValue(undefined);
  const handler = new CompleteSessionHandler(repository, auditRecorder, clock, enqueueNotification);
  return { handler, repository, auditRecorder, enqueueNotification };
}

const BASE_INPUT = { sessionId: 'session-1', expectedVersion: 4, actorId: 'mcs-1', correlationId: 'corr-1' };

describe('CompleteSessionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for an unknown session', async () => {
    const { handler } = buildHandler({ repository: { completeSession: vi.fn().mockResolvedValue({ outcome: 'not_found' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns INVALID_STATUS_TRANSITION when not started/interrupted', async () => {
    const { handler } = buildHandler({ repository: { completeSession: vi.fn().mockResolvedValue({ outcome: 'invalid_transition' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns CONSULTATION_IN_PROGRESS when a patient is still being seen', async () => {
    const { handler } = buildHandler({ repository: { completeSession: vi.fn().mockResolvedValue({ outcome: 'consultation_in_progress' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONSULTATION_IN_PROGRESS');
  });

  it('returns CONFLICT_STALE_VERSION with the current representation', async () => {
    const { handler } = buildHandler({ repository: { completeSession: vi.fn().mockResolvedValue({ outcome: 'stale' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details).toEqual({ current: SESSION });
    }
  });

  it('on success: notifies expired appointments with an apology template, audits, reports the count', async () => {
    const { handler, auditRecorder, enqueueNotification } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ sessionId: 'session-1', status: 'completed', actuallyEndedAt: NOW, expiredAppointments: 1, version: 5 });
    expect(enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'student-1', templateKey: 'session_completed_expired', channel: 'in_app' }));
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'completed', entityId: 'session-1' }));
  });
});
