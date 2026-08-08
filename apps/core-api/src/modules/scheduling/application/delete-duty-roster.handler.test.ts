import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import { DeleteDutyRosterHandler } from './delete-duty-roster.handler.js';
import type { DutyRosterRepository } from './duty-roster-repository.js';

function buildHandler(overrides: { readonly repository?: Partial<DutyRosterRepository> } = {}) {
  const repository: DutyRosterRepository = {
    listDutyRosters: vi.fn(),
    findDutyRosterById: vi.fn(),
    doctorExists: vi.fn(),
    createDutyRoster: vi.fn(),
    updateDutyRoster: vi.fn(),
    deleteDutyRoster: vi.fn().mockResolvedValue({ outcome: 'deleted' }),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const handler = new DeleteDutyRosterHandler(repository, auditRecorder);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { rosterId: 'roster-1', reason: 'Doctor moved to the afternoon clinic', actorId: 'mcs-1', correlationId: 'corr-1' };

describe('DeleteDutyRosterHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a reason under 10 characters — VR-93', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.deleteDutyRoster).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown roster', async () => {
    const { handler } = buildHandler({ repository: { deleteDutyRoster: vi.fn().mockResolvedValue({ outcome: 'not_found' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('on success: audits as "deactivated" (not deleted — the row is retained, P4)', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'deactivated', afterState: { reason: BASE_INPUT.reason } }));
  });
});
