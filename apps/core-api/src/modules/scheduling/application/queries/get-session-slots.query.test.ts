import { describe, expect, it, vi } from 'vitest';

import type { PolicyStore } from '../../../../kernel/policy/policy-store.js';
import type { ClinicSessionListItem, ClinicSessionRepository, SessionSlotItem } from '../clinic-session-repository.js';

import { GetSessionSlotsQuery } from './get-session-slots.query.js';

const SESSION: ClinicSessionListItem = {
  sessionId: 'session-1',
  doctorId: 'doctor-1',
  doctorName: 'Dr. Rahman',
  locationId: 'location-1',
  sessionDate: '2026-08-10',
  startsAt: new Date('2026-08-10T09:00:00+06:00'),
  endsAt: new Date('2026-08-10T13:00:00+06:00'),
  slotLengthMinutes: 10,
  walkInAllocationPct: 30,
  totalSlotCount: 24,
  bookableSlotCount: 16,
  bookedSlotCount: 2,
  status: 'scheduled',
  nextSerial: 1,
  actuallyStartedAt: null,
  actuallyEndedAt: null,
  changeReason: null,
  isOverride: true,
  version: 1,
};

const ITEMS: SessionSlotItem[] = [
  { slotId: 'slot-1', slotIndex: 0, slotStartsAt: new Date('2026-08-10T09:00:00+06:00'), isAvailable: false },
  { slotId: 'slot-2', slotIndex: 1, slotStartsAt: new Date('2026-08-10T09:10:00+06:00'), isAvailable: true },
  { slotId: 'slot-3', slotIndex: 2, slotStartsAt: new Date('2026-08-10T09:20:00+06:00'), isAvailable: false },
];

function buildQuery(overrides: { readonly repository?: Partial<ClinicSessionRepository>; readonly cutoffMinutes?: number } = {}) {
  const repository: ClinicSessionRepository = {
    listClinicSessions: vi.fn(),
    findClinicSessionById: vi.fn().mockResolvedValue(SESSION),
    findDoctorLocationId: vi.fn(),
    findServiceCalendarClosure: vi.fn(),
    countBookedAppointments: vi.fn(),
    createClinicSession: vi.fn(),
    updateClinicSession: vi.fn(),
    listSessionSlots: vi.fn().mockResolvedValue(ITEMS),
    getQueueSummary: vi.fn(),
    ...overrides.repository,
  };
  const policyStore = { getRequiredInteger: vi.fn().mockResolvedValue(overrides.cutoffMinutes ?? 0) } as unknown as PolicyStore;
  return { query: new GetSessionSlotsQuery(repository, policyStore), repository };
}

describe('GetSessionSlotsQuery', () => {
  it('returns 404 for an unknown session', async () => {
    const { query } = buildQuery({ repository: { findClinicSessionById: vi.fn().mockResolvedValue(null) } });
    const result = await query.execute('missing', false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.httpStatus).toBe(404);
  });

  it('returns every item and a summary computed over the full set when availableOnly is false', async () => {
    const { query } = buildQuery();
    const result = await query.execute('session-1', false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(3);
      expect(result.value.summary).toEqual({ bookable: 3, booked: 2, remaining: 1 });
    }
  });

  it('filters to available items only, but keeps the summary over the full set', async () => {
    const { query } = buildQuery();
    const result = await query.execute('session-1', true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toEqual([ITEMS[1]]);
      expect(result.value.summary).toEqual({ bookable: 3, booked: 2, remaining: 1 });
    }
  });

  it('defaults bookingClosesAt to the session start (cutoff 0)', async () => {
    const { query } = buildQuery({ cutoffMinutes: 0 });
    const result = await query.execute('session-1', false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.bookingClosesAt).toEqual(SESSION.startsAt);
  });
});
