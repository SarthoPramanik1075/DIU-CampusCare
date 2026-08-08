import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';

import type { ClinicSessionListItem, ClinicSessionRepository } from './clinic-session-repository.js';
import { StartSessionHandler } from './start-session.handler.js';

const NOW = new Date('2026-08-10T09:00:00Z');

const SESSION: ClinicSessionListItem = {
  sessionId: 'session-1',
  doctorId: 'doctor-1',
  doctorName: 'Dr. Rahman',
  locationId: 'location-1',
  sessionDate: '2026-08-10',
  startsAt: NOW,
  endsAt: new Date('2026-08-10T13:00:00Z'),
  slotLengthMinutes: 10,
  walkInAllocationPct: 30,
  totalSlotCount: 24,
  bookableSlotCount: 16,
  bookedSlotCount: 0,
  status: 'started',
  nextSerial: 1,
  actuallyStartedAt: NOW,
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
    updateClinicSession: vi.fn(),
    listSessionSlots: vi.fn(),
    getQueueSummary: vi.fn(),
    listOpenAppointments: vi.fn(),
    startSession: vi.fn().mockResolvedValue({ outcome: 'started', session: SESSION }),
    interruptSession: vi.fn(),
    countInConsultation: vi.fn(),
    completeSession: vi.fn(),
    cancelSession: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new StartSessionHandler(repository, auditRecorder, clock);
  return { handler, repository, auditRecorder, clock };
}

const BASE_INPUT = { sessionId: 'session-1', expectedVersion: 1, actorId: 'mcs-1', correlationId: 'corr-1' };

describe('StartSessionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for an unknown session', async () => {
    const { handler } = buildHandler({ repository: { startSession: vi.fn().mockResolvedValue({ outcome: 'not_found' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns INVALID_STATUS_TRANSITION when the session cannot be started', async () => {
    const { handler } = buildHandler({ repository: { startSession: vi.fn().mockResolvedValue({ outcome: 'invalid_transition' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns CONFLICT_STALE_VERSION with the current representation', async () => {
    const { handler } = buildHandler({ repository: { startSession: vi.fn().mockResolvedValue({ outcome: 'stale' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details).toEqual({ current: SESSION });
    }
  });

  it('on success: audits as "started" and returns the session', async () => {
    const { handler, repository, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(SESSION);
    expect(repository.startSession).toHaveBeenCalledWith('session-1', 1, NOW);
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'started', entityId: 'session-1' }));
  });
});
