import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Clock } from '../../../../kernel/clock/clock.js';
import type { PolicyStore } from '../../../../kernel/policy/policy-store.js';
import type { ClinicSessionRepository } from '../clinic-session-repository.js';

import { GetPublicAvailabilityQuery } from './get-public-availability.query.js';

const NOW = new Date('2026-08-03T10:00:00Z');

function buildQuery(overrides: { readonly repository?: Partial<ClinicSessionRepository>; readonly windowDays?: number } = {}) {
  const repository: ClinicSessionRepository = {
    listClinicSessions: vi.fn(),
    findClinicSessionById: vi.fn(),
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
    completeSession: vi.fn(),
    cancelSession: vi.fn(),
    findDefaultLocationId: vi.fn().mockResolvedValue('location-1'),
    listPublicAvailability: vi.fn().mockResolvedValue([]),
    ...overrides.repository,
  };
  const policyStore = { getRequiredInteger: vi.fn().mockResolvedValue(overrides.windowDays ?? 7) } as unknown as PolicyStore;
  const clock: Clock = { now: () => NOW };
  return { query: new GetPublicAvailabilityQuery(repository, policyStore, clock), repository };
}

describe('GetPublicAvailabilityQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a "from" date in the past — INVALID_DATE_RANGE', async () => {
    const { query, repository } = buildQuery();
    const result = await query.execute('2026-08-01', undefined, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
    expect(repository.listPublicAvailability).not.toHaveBeenCalled();
  });

  it('rejects a "to" before "from"', async () => {
    const { query } = buildQuery();
    const result = await query.execute('2026-08-05', '2026-08-04', undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('defaults from to today and to to from+6 days', async () => {
    const { query, repository } = buildQuery();
    const result = await query.execute(undefined, undefined, undefined);
    expect(result.ok).toBe(true);
    expect(repository.listPublicAvailability).toHaveBeenCalledWith('location-1', '2026-08-03', '2026-08-09', undefined);
  });

  it('silently clamps "to" to the publication window rather than rejecting', async () => {
    const { query, repository } = buildQuery({ windowDays: 7 });
    const result = await query.execute('2026-08-03', '2026-09-01', undefined);
    expect(result.ok).toBe(true);
    // window is 7 days from today (2026-08-03..2026-08-09 inclusive)
    expect(repository.listPublicAvailability).toHaveBeenCalledWith('location-1', '2026-08-03', '2026-08-09', undefined);
  });

  it('passes doctorId through when given', async () => {
    const { query, repository } = buildQuery();
    await query.execute('2026-08-03', '2026-08-03', 'doctor-1');
    expect(repository.listPublicAvailability).toHaveBeenCalledWith('location-1', '2026-08-03', '2026-08-03', 'doctor-1');
  });

  it('returns asOf and publicationWindowDays alongside the days', async () => {
    const { query } = buildQuery({ windowDays: 7 });
    const result = await query.execute('2026-08-03', '2026-08-03', undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.asOf).toEqual(NOW);
      expect(result.value.publicationWindowDays).toBe(7);
    }
  });
});
