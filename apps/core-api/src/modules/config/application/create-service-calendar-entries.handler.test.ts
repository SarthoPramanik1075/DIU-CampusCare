import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { ServiceCalendarEntry } from '../domain/service-calendar.js';

import { CreateServiceCalendarEntriesHandler } from './create-service-calendar-entries.handler.js';
import type { ServiceCalendarRepository } from './service-calendar-repository.js';

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
    findDefaultLocationId: vi.fn().mockResolvedValue('location-1'),
    listEntries: vi.fn(),
    findEntryById: vi.fn(),
    createEntries: vi.fn().mockResolvedValue({ outcome: 'created', items: [ENTRY], conflictingSessions: [] }),
    findConflictingSessions: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const handler = new CreateServiceCalendarEntriesHandler(repository, auditRecorder);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { fromDate: '2026-08-15', toDate: '2026-08-15', isServiceDay: false, reason: 'National Mourning Day', actorId: 'adm-1', correlationId: 'corr-1' };

describe('CreateServiceCalendarEntriesHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects toDate before fromDate — INVALID_DATE_RANGE', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, fromDate: '2026-08-16', toDate: '2026-08-15' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
    expect(repository.findDefaultLocationId).not.toHaveBeenCalled();
  });

  it('rejects a range over 366 days — INVALID_DATE_RANGE', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, fromDate: '2026-01-01', toDate: '2027-06-01' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('rejects an empty reason', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns CALENDAR_ENTRY_EXISTS when a date in the range already has an entry', async () => {
    const { handler } = buildHandler({ repository: { createEntries: vi.fn().mockResolvedValue({ outcome: 'conflict', conflictingDate: '2026-08-15' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CALENDAR_ENTRY_EXISTS');
      expect(result.error.details).toEqual({ conflictingDate: '2026-08-15' });
    }
  });

  it('on success: creates one row per date, reports conflicting sessions, audits', async () => {
    const { handler, repository, auditRecorder } = buildHandler({
      repository: { createEntries: vi.fn().mockResolvedValue({ outcome: 'created', items: [ENTRY], conflictingSessions: [{ sessionId: 's-1', doctorName: 'Dr. Rahman', sessionDate: '2026-08-15' }] }) },
    });
    const result = await handler.execute({ ...BASE_INPUT, fromDate: '2026-08-15', toDate: '2026-08-16' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.created).toBe(1);
      expect(result.value.conflictingSessions).toHaveLength(1);
    }
    expect(repository.createEntries).toHaveBeenCalledWith('location-1', ['2026-08-15', '2026-08-16'], false, 'National Mourning Day', 'adm-1');
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created', entityType: 'config.service_calendar' }));
  });
});
