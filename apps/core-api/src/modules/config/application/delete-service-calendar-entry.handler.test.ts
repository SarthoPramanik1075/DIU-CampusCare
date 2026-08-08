import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import type { ServiceCalendarEntry } from '../domain/service-calendar.js';

import { DeleteServiceCalendarEntryHandler } from './delete-service-calendar-entry.handler.js';
import type { ServiceCalendarRepository } from './service-calendar-repository.js';

const NOW = new Date('2026-08-01T00:00:00Z');

const FUTURE_ENTRY: ServiceCalendarEntry = {
  id: 'entry-1',
  locationId: 'location-1',
  calendarDate: '2026-08-15',
  isServiceDay: false,
  reason: 'National Mourning Day',
  createdBy: 'adm-1',
  createdByName: 'DIU IT',
  createdAt: NOW,
  version: 1,
};

function buildHandler(overrides: { readonly repository?: Partial<ServiceCalendarRepository> } = {}) {
  const repository: ServiceCalendarRepository = {
    findDefaultLocationId: vi.fn(),
    listEntries: vi.fn(),
    findEntryById: vi.fn().mockResolvedValue(FUTURE_ENTRY),
    createEntries: vi.fn(),
    findConflictingSessions: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn().mockResolvedValue('deleted'),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new DeleteServiceCalendarEntryHandler(repository, auditRecorder, clock);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { entryId: 'entry-1', actorId: 'adm-1', correlationId: 'corr-1' };

describe('DeleteServiceCalendarEntryHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for an unknown entry', async () => {
    const { handler } = buildHandler({ repository: { findEntryById: vi.fn().mockResolvedValue(null) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns CANNOT_EDIT_PAST when the date has already passed', async () => {
    const { handler, repository } = buildHandler({ repository: { findEntryById: vi.fn().mockResolvedValue({ ...FUTURE_ENTRY, calendarDate: '2026-07-01' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANNOT_EDIT_PAST');
    expect(repository.deleteEntry).not.toHaveBeenCalled();
  });

  it('on success: deletes and audits', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted', entityId: 'entry-1' }));
  });
});
