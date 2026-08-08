import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';

import type { ClinicSessionListItem, ClinicSessionRepository } from './clinic-session-repository.js';
import { UpdateClinicSessionHandler } from './update-clinic-session.handler.js';

const NOW = new Date('2026-08-01T00:00:00Z');

const SESSION: ClinicSessionListItem = {
  sessionId: 'session-1',
  doctorId: 'doctor-1',
  doctorName: 'Dr. Rahman',
  locationId: 'location-1',
  sessionDate: '2026-08-10',
  startsAt: new Date('2026-08-10T03:00:00Z'),
  endsAt: new Date('2026-08-10T07:00:00Z'),
  slotLengthMinutes: 10,
  walkInAllocationPct: 30,
  totalSlotCount: 24,
  bookableSlotCount: 16,
  bookedSlotCount: 5,
  status: 'scheduled',
  nextSerial: 1,
  actuallyStartedAt: null,
  actuallyEndedAt: null,
  changeReason: null,
  isOverride: true,
  version: 2,
};

function buildHandler(overrides: { readonly repository?: Partial<ClinicSessionRepository> } = {}) {
  const repository: ClinicSessionRepository = {
    listClinicSessions: vi.fn(),
    findClinicSessionById: vi.fn().mockResolvedValue(SESSION),
    findDoctorLocationId: vi.fn(),
    findServiceCalendarClosure: vi.fn(),
    countBookedAppointments: vi.fn(),
    createClinicSession: vi.fn(),
    updateClinicSession: vi.fn().mockResolvedValue({ outcome: 'updated', session: { ...SESSION, endsAt: new Date('2026-08-10T07:30:00Z'), version: 3 } }),
    listSessionSlots: vi.fn(),
    getQueueSummary: vi.fn(),    listOpenAppointments: vi.fn(),    startSession: vi.fn(),    interruptSession: vi.fn(),    countInConsultation: vi.fn(),    completeSession: vi.fn(),    cancelSession: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new UpdateClinicSessionHandler(repository, auditRecorder, clock);
  return { handler, repository, auditRecorder, clock };
}

const BASE_INPUT = {
  sessionId: 'session-1',
  startsAt: undefined,
  endsAt: new Date('2026-08-10T07:30:00Z'),
  slotLengthMinutes: undefined,
  walkInAllocationPct: undefined,
  changeReason: undefined,
  expectedVersion: 2,
  actorId: 'mcs-1',
  correlationId: 'corr-1',
};

describe('UpdateClinicSessionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for an unknown session', async () => {
    const { handler } = buildHandler({ repository: { findClinicSessionById: vi.fn().mockResolvedValue(null) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('rejects retiming a session that has already started — SESSION_ALREADY_STARTED', async () => {
    const { handler, repository } = buildHandler({ repository: { findClinicSessionById: vi.fn().mockResolvedValue({ ...SESSION, status: 'started' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_ALREADY_STARTED');
    expect(repository.updateClinicSession).not.toHaveBeenCalled();
  });

  it('allows a non-retiming update (changeReason only) on a started session', async () => {
    const { handler, repository } = buildHandler({
      repository: {
        findClinicSessionById: vi.fn().mockResolvedValue({ ...SESSION, status: 'started' }),
        updateClinicSession: vi.fn().mockResolvedValue({ outcome: 'updated', session: SESSION }),
      },
    });
    const result = await handler.execute({ ...BASE_INPUT, endsAt: undefined, changeReason: 'Doctor arriving late from an external commitment' });
    expect(result.ok).toBe(true);
    expect(repository.updateClinicSession).toHaveBeenCalled();
  });

  it('rejects end time not after start time — VR-10', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, startsAt: new Date('2026-08-10T08:00:00Z'), endsAt: new Date('2026-08-10T07:00:00Z') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects reducing capacity below existing bookings — CAPACITY_BELOW_BOOKINGS', async () => {
    const { handler, repository } = buildHandler();
    // 5 already booked; walk-in raised to 90% collapses bookable capacity to well under 5.
    const result = await handler.execute({ ...BASE_INPUT, endsAt: undefined, walkInAllocationPct: 90 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CAPACITY_BELOW_BOOKINGS');
      expect(result.error.details).toEqual(expect.objectContaining({ bookedCount: 5 }));
    }
    expect(repository.updateClinicSession).not.toHaveBeenCalled();
  });

  it('requires a change reason when the new time falls within 24 hours — VR-18', async () => {
    const { handler } = buildHandler({ repository: { findClinicSessionById: vi.fn().mockResolvedValue({ ...SESSION, startsAt: new Date(NOW.getTime() + 60 * 60 * 1000) }) } });
    const result = await handler.execute({ ...BASE_INPUT, endsAt: new Date(NOW.getTime() + 5 * 60 * 60 * 1000), changeReason: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns SESSION_OVERLAP when the repository reports a conflict', async () => {
    const { handler } = buildHandler({ repository: { updateClinicSession: vi.fn().mockResolvedValue({ outcome: 'overlap', conflictingSession: SESSION }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_OVERLAP');
  });

  it('returns CONFLICT_STALE_VERSION with the current representation', async () => {
    const { handler } = buildHandler({ repository: { updateClinicSession: vi.fn().mockResolvedValue({ outcome: 'stale' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details).toEqual({ current: SESSION });
    }
  });

  it('on success: audits and returns the updated session', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.endsAt).toEqual(new Date('2026-08-10T07:30:00Z'));
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'updated', entityId: 'session-1' }));
  });
});
