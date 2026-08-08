import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import { CreateDutyRosterHandler } from './create-duty-roster.handler.js';
import type { DutyRoster, DutyRosterRepository } from './duty-roster-repository.js';

const CREATED_ROSTER: DutyRoster = {
  rosterId: 'roster-1',
  doctorId: 'doctor-1',
  weekday: 1,
  startsAtLocal: '09:00',
  endsAtLocal: '13:00',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  isActive: true,
  version: 1,
};

function buildHandler(overrides: { readonly repository?: Partial<DutyRosterRepository> } = {}) {
  const repository: DutyRosterRepository = {
    listDutyRosters: vi.fn(),
    findDutyRosterById: vi.fn(),
    doctorExists: vi.fn().mockResolvedValue(true),
    createDutyRoster: vi.fn().mockResolvedValue({ outcome: 'created', roster: CREATED_ROSTER }),
    updateDutyRoster: vi.fn(),
    deleteDutyRoster: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const handler = new CreateDutyRosterHandler(repository, auditRecorder);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = {
  doctorId: 'doctor-1',
  weekday: 1,
  startsAtLocal: '09:00',
  endsAtLocal: '13:00',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  actorId: 'mcs-1',
  correlationId: 'corr-1',
};

describe('CreateDutyRosterHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an out-of-range weekday', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, weekday: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.doctorExists).not.toHaveBeenCalled();
  });

  it('rejects end time not after start time — VR-10', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, startsAtLocal: '13:00', endsAtLocal: '09:00' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects effectiveTo before effectiveFrom', async () => {
    const { handler } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, effectiveTo: '2025-01-01' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 when the doctor does not exist', async () => {
    const { handler, repository } = buildHandler({ repository: { doctorExists: vi.fn().mockResolvedValue(false) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
    expect(repository.createDutyRoster).not.toHaveBeenCalled();
  });

  it('returns ROSTER_OVERLAP naming the conflicting entry by day and time', async () => {
    const { handler } = buildHandler({
      repository: { createDutyRoster: vi.fn().mockResolvedValue({ outcome: 'overlap', conflictingRoster: CREATED_ROSTER }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ROSTER_OVERLAP');
      expect(result.error.message).toContain('Monday');
      expect(result.error.message).toContain('09:00');
    }
  });

  it('on success: audits and returns the created roster', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(CREATED_ROSTER);
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created', entityType: 'scheduling.duty_roster' }));
  });
});
