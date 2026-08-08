import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { ServiceCalendarEntry } from '../domain/service-calendar.js';

import type { ServiceCalendarRepository } from './service-calendar-repository.js';
import { UpdateServiceCalendarEntryHandler } from './update-service-calendar-entry.handler.js';

const ENTRY: ServiceCalendarEntry = {
  id: 'entry-1',
  locationId: 'location-1',
  calendarDate: '2026-08-15',
  isServiceDay: false,
  reason: 'National Mourning Day',
  createdBy: 'adm-1',
  createdByName: 'DIU IT',
  createdAt: new Date('2026-01-05T03:00:00Z'),
  version: 1,
};

function buildHandler(overrides: { readonly repository?: Partial<ServiceCalendarRepository> } = {}) {
  const repository: ServiceCalendarRepository = {
    findDefaultLocationId: vi.fn(),
    listEntries: vi.fn(),
    findEntryById: vi.fn().mockResolvedValue(ENTRY),
    createEntries: vi.fn(),
    findConflictingSessions: vi.fn(),
    updateEntry: vi.fn().mockResolvedValue({ outcome: 'updated', entry: { ...ENTRY, reason: 'National Mourning Day — university closed', version: 2 } }),
    deleteEntry: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const handler = new UpdateServiceCalendarEntryHandler(repository, auditRecorder);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { entryId: 'entry-1', isServiceDay: undefined, reason: 'National Mourning Day — university closed', expectedVersion: 1, actorId: 'adm-1', correlationId: 'corr-1' };

describe('UpdateServiceCalendarEntryHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an empty reason when present', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.updateEntry).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown entry', async () => {
    const { handler } = buildHandler({ repository: { updateEntry: vi.fn().mockResolvedValue({ outcome: 'not_found' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns CONFLICT_STALE_VERSION with the current representation', async () => {
    const { handler } = buildHandler({ repository: { updateEntry: vi.fn().mockResolvedValue({ outcome: 'stale' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details).toEqual({ current: ENTRY });
    }
  });

  it('on success: audits and returns the updated entry', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.reason).toBe('National Mourning Day — university closed');
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'updated', entityId: 'entry-1' }));
  });
});
