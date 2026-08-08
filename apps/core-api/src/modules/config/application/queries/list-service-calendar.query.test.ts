import { describe, expect, it, vi } from 'vitest';

import type { ServiceCalendarRepository } from '../service-calendar-repository.js';

import { ListServiceCalendarQuery } from './list-service-calendar.query.js';

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
  return { query: new ListServiceCalendarQuery(repository), repository };
}

describe('ListServiceCalendarQuery', () => {
  it('rejects a "to" before "from"', async () => {
    const { query, repository } = buildQuery();
    const result = await query.execute('2026-08-15', '2026-08-10');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.listEntries).not.toHaveBeenCalled();
  });

  it('has no range cap, unlike the public endpoint', async () => {
    const { query, repository } = buildQuery();
    const result = await query.execute('2026-01-01', '2027-01-01');
    expect(result.ok).toBe(true);
    expect(repository.listEntries).toHaveBeenCalledWith('location-1', '2026-01-01', '2027-01-01');
  });
});
