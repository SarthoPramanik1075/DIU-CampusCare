import { describe, expect, it, vi } from 'vitest';

import type { ClinicSessionRepository } from '../clinic-session-repository.js';

import { ListClinicSessionsQuery } from './list-clinic-sessions.query.js';

function buildQuery(overrides: { readonly repository?: Partial<ClinicSessionRepository> } = {}) {
  const repository: ClinicSessionRepository = {
    listClinicSessions: vi.fn().mockResolvedValue([]),
    findClinicSessionById: vi.fn(),
    findDoctorLocationId: vi.fn(),
    findServiceCalendarClosure: vi.fn(),
    countBookedAppointments: vi.fn(),
    createClinicSession: vi.fn(),
    updateClinicSession: vi.fn(),
    listSessionSlots: vi.fn(),
    getQueueSummary: vi.fn(),    listOpenAppointments: vi.fn(),    startSession: vi.fn(),    interruptSession: vi.fn(),    countInConsultation: vi.fn(),    completeSession: vi.fn(),    cancelSession: vi.fn(),
    ...overrides.repository,
  };
  return { query: new ListClinicSessionsQuery(repository), repository };
}

describe('ListClinicSessionsQuery', () => {
  it('rejects a "to" before "from" — INVALID_DATE_RANGE', async () => {
    const { query, repository } = buildQuery();
    const result = await query.execute({ from: '2026-08-10', to: '2026-08-05' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
    expect(repository.listClinicSessions).not.toHaveBeenCalled();
  });

  it('rejects a range over 60 days — INVALID_DATE_RANGE', async () => {
    const { query } = buildQuery();
    const result = await query.execute({ from: '2026-01-01', to: '2026-06-01' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('allows a same-day and a 60-day range', async () => {
    const { query } = buildQuery();
    expect((await query.execute({ from: '2026-08-10', to: '2026-08-10' })).ok).toBe(true);
    expect((await query.execute({ from: '2026-08-01', to: '2026-09-30' })).ok).toBe(true);
  });
});
