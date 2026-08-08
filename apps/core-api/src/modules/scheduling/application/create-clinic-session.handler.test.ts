import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';

import type { ClinicSessionListItem, ClinicSessionRepository } from './clinic-session-repository.js';
import { CreateClinicSessionHandler } from './create-clinic-session.handler.js';

const NOW = new Date('2026-08-01T00:00:00Z');

const CREATED_SESSION: ClinicSessionListItem = {
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
  bookableSlotCount: 17,
  bookedSlotCount: 0,
  status: 'scheduled',
  nextSerial: 1,
  actuallyStartedAt: null,
  actuallyEndedAt: null,
  changeReason: null,
  isOverride: true,
  version: 1,
};

function buildHandler(overrides: { readonly repository?: Partial<ClinicSessionRepository>; readonly policyOverrides?: Record<string, number> } = {}) {
  const policyValues: Record<string, number> = { 'scheduling.session.defaultSlotLengthMinutes': 10, 'scheduling.session.defaultWalkInAllocationPct': 30, ...overrides.policyOverrides };
  const repository: ClinicSessionRepository = {
    listClinicSessions: vi.fn(),
    findClinicSessionById: vi.fn(),
    findDoctorLocationId: vi.fn().mockResolvedValue('location-1'),
    findServiceCalendarClosure: vi.fn().mockResolvedValue(null),
    countBookedAppointments: vi.fn().mockResolvedValue(0),
    createClinicSession: vi.fn().mockResolvedValue({ outcome: 'created', session: CREATED_SESSION }),
    updateClinicSession: vi.fn(),
    listSessionSlots: vi.fn(),
    getQueueSummary: vi.fn(),
    ...overrides.repository,
  };
  const policyStore = { getRequiredInteger: vi.fn((key: string) => Promise.resolve(policyValues[key])) } as unknown as PolicyStore;
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new CreateClinicSessionHandler(repository, policyStore, auditRecorder, clock);
  return { handler, repository, auditRecorder, clock };
}

const BASE_INPUT = {
  doctorId: 'doctor-1',
  dutyRosterId: null,
  sessionDate: '2026-08-10',
  startsAt: new Date('2026-08-10T03:00:00Z'),
  endsAt: new Date('2026-08-10T07:00:00Z'),
  slotLengthMinutes: undefined,
  walkInAllocationPct: undefined,
  changeReason: null,
  overrideNonServiceDay: false,
  actorId: 'mcs-1',
  correlationId: 'corr-1',
};

describe('CreateClinicSessionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects end time not after start time — VR-10', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, startsAt: new Date('2026-08-10T07:00:00Z'), endsAt: new Date('2026-08-10T03:00:00Z') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.findDoctorLocationId).not.toHaveBeenCalled();
  });

  it('rejects a session date in the past — VR-15', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, sessionDate: '2020-01-01' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an invalid slot length — VR-12', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, slotLengthMinutes: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a session shorter than one slot — VR-11 (SESSION_TOO_SHORT)', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, slotLengthMinutes: 60, endsAt: new Date('2026-08-10T03:30:00Z') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_TOO_SHORT');
  });

  it('rejects a 100% walk-in allocation — VR-13 (WALK_IN_ALLOCATION_INVALID)', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, walkInAllocationPct: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WALK_IN_ALLOCATION_INVALID');
  });

  it('returns 404 when the doctor does not exist', async () => {
    const { handler, repository } = buildHandler({ repository: { findDoctorLocationId: vi.fn().mockResolvedValue(null) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
    expect(repository.createClinicSession).not.toHaveBeenCalled();
  });

  it('returns NON_SERVICE_DAY when the date is closed and overrideNonServiceDay is not set', async () => {
    const { handler } = buildHandler({
      repository: { findServiceCalendarClosure: vi.fn().mockResolvedValue({ id: 'cal-1', calendarDate: '2026-08-10', reason: 'National Mourning Day' }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NON_SERVICE_DAY');
  });

  it('allows a non-service day when overrideNonServiceDay is true', async () => {
    const { handler } = buildHandler({
      repository: { findServiceCalendarClosure: vi.fn().mockResolvedValue({ id: 'cal-1', calendarDate: '2026-08-10', reason: 'National Mourning Day' }) },
    });
    const result = await handler.execute({ ...BASE_INPUT, overrideNonServiceDay: true });
    expect(result.ok).toBe(true);
  });

  it('requires a change reason when the session starts within 24 hours — VR-18', async () => {
    const { handler } = buildHandler();
    const soonStart = new Date(NOW.getTime() + 60 * 60 * 1000);
    const soonEnd = new Date(soonStart.getTime() + 4 * 60 * 60 * 1000);
    const result = await handler.execute({ ...BASE_INPUT, startsAt: soonStart, endsAt: soonEnd, changeReason: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns SESSION_OVERLAP when the repository reports a conflict', async () => {
    const { handler } = buildHandler({ repository: { createClinicSession: vi.fn().mockResolvedValue({ outcome: 'overlap', conflictingSession: CREATED_SESSION }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_OVERLAP');
  });

  it('on success: derives slots, creates the session, audits, and returns it', async () => {
    const { handler, repository, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(CREATED_SESSION);
    expect(repository.createClinicSession).toHaveBeenCalledWith(
      expect.objectContaining({ doctorId: 'doctor-1', locationId: 'location-1', totalSlotCount: 24, bookableSlotCount: 16, slots: expect.any(Array) }),
    );
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created', entityType: 'scheduling.clinic_session' }));
  });
});
