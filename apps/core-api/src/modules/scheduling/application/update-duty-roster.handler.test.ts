import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import type { DutyRoster, DutyRosterRepository } from './duty-roster-repository.js';
import { UpdateDutyRosterHandler } from './update-duty-roster.handler.js';

const ROSTER: DutyRoster = {
  rosterId: 'roster-1',
  doctorId: 'doctor-1',
  weekday: 1,
  startsAtLocal: '09:00',
  endsAtLocal: '13:00',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  isActive: true,
  version: 2,
};

function buildHandler(overrides: { readonly repository?: Partial<DutyRosterRepository> } = {}) {
  const repository: DutyRosterRepository = {
    listDutyRosters: vi.fn(),
    findDutyRosterById: vi.fn().mockResolvedValue(ROSTER),
    doctorExists: vi.fn(),
    createDutyRoster: vi.fn(),
    updateDutyRoster: vi.fn().mockResolvedValue({ outcome: 'updated', roster: { ...ROSTER, endsAtLocal: '14:00', version: 3 } }),
    deleteDutyRoster: vi.fn(),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const handler = new UpdateDutyRosterHandler(repository, auditRecorder);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = {
  rosterId: 'roster-1',
  weekday: undefined,
  startsAtLocal: undefined,
  endsAtLocal: '14:00',
  effectiveFrom: undefined,
  effectiveTo: undefined,
  expectedVersion: 2,
  actorId: 'mcs-1',
  correlationId: 'corr-1',
};

describe('UpdateDutyRosterHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects end time not after start time when both are given', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, startsAtLocal: '15:00', endsAtLocal: '14:00' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.updateDutyRoster).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown roster', async () => {
    const { handler } = buildHandler({ repository: { updateDutyRoster: vi.fn().mockResolvedValue({ outcome: 'not_found' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns ROSTER_OVERLAP when the update would conflict', async () => {
    const { handler } = buildHandler({
      repository: { updateDutyRoster: vi.fn().mockResolvedValue({ outcome: 'overlap', conflictingRoster: ROSTER }) },
    });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROSTER_OVERLAP');
  });

  it('returns CONFLICT_STALE_VERSION with the current representation', async () => {
    const { handler } = buildHandler({ repository: { updateDutyRoster: vi.fn().mockResolvedValue({ outcome: 'stale' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details).toEqual({ current: ROSTER });
    }
  });

  it('on success: audits and returns the updated roster', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.endsAtLocal).toBe('14:00');
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'updated', entityId: 'roster-1' }));
  });
});
