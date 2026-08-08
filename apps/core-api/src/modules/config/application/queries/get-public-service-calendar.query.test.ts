import { describe, expect, it, vi } from 'vitest';

import type { ServiceCalendarRepository } from '../service-calendar-repository.js';

import { GetPublicServiceCalendarQuery } from './get-public-service-calendar.query.js';

function buildQuery(overrides: { readonly repository?: Partial<ServiceCalendarRepository> } = {}) {
  const repository: ServiceCalendarRepository = {
    findDefaultLocationId: vi.fn().mockResolvedValue('location-1'),
    listEntries: vi.fn().mockResolvedValue([]),
    findEntryById: vi.fn(),
    createEntries: vi.fn(),
    findConflictingSessions: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    ...overrides.repository,
  };
  return { query: new GetPublicServiceCalendarQuery(repository), repository };
}

describe('GetPublicServiceCalendarQuery', () => {
  it('rejects a "to" before "from" — INVALID_DATE_RANGE', async () => {
    const { query, repository } = buildQuery();
    const result = await query.execute('2026-08-15', '2026-08-10');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
    expect(repository.listEntries).not.toHaveBeenCalled();
  });

  it('rejects a range over 90 days', async () => {
    const { query } = buildQuery();
    const result = await query.execute('2026-01-01', '2026-06-01');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('resolves the default location and lists entries within a valid range', async () => {
    const { query, repository } = buildQuery();
    const result = await query.execute('2026-08-01', '2026-08-30');
    expect(result.ok).toBe(true);
    expect(repository.listEntries).toHaveBeenCalledWith('location-1', '2026-08-01', '2026-08-30');
  });
});
