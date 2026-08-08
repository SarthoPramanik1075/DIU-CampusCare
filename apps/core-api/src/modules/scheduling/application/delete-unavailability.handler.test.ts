import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';

import { DeleteUnavailabilityHandler } from './delete-unavailability.handler.js';
import type { UnavailabilityRecord, UnavailabilityRepository } from './unavailability-repository.js';

const NOW = new Date('2026-08-01T00:00:00Z');

const FUTURE_RECORD: UnavailabilityRecord = { unavailabilityId: 'unavail-1', doctorId: 'doctor-1', startDate: '2026-08-20', endDate: '2026-08-24', reason: 'x', createdBy: 'mcs-1', createdAt: NOW };

function buildHandler(overrides: { readonly repository?: Partial<UnavailabilityRepository> } = {}) {
  const repository: UnavailabilityRepository = {
    doctorExists: vi.fn(),
    findOverlappingUnavailability: vi.fn(),
    computeImpact: vi.fn(),
    createPreview: vi.fn(),
    findPreview: vi.fn(),
    createUnavailability: vi.fn(),
    listUnavailability: vi.fn(),
    findUnavailabilityById: vi.fn().mockResolvedValue(FUTURE_RECORD),
    deleteUnavailability: vi.fn().mockResolvedValue('deleted'),
    ...overrides.repository,
  };
  const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
  const clock: Clock = { now: () => NOW };
  const handler = new DeleteUnavailabilityHandler(repository, auditRecorder, clock);
  return { handler, repository, auditRecorder };
}

const BASE_INPUT = { unavailabilityId: 'unavail-1', reason: 'Leave withdrawn at the doctor’s request', actorId: 'mcs-1', correlationId: 'corr-1' };

describe('DeleteUnavailabilityHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a reason under 10 characters — VR-93', async () => {
    const { handler, repository } = buildHandler();
    const result = await handler.execute({ ...BASE_INPUT, reason: 'short' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.findUnavailabilityById).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown period', async () => {
    const { handler } = buildHandler({ repository: { findUnavailabilityById: vi.fn().mockResolvedValue(null) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { httpStatus: number }).httpStatus).toBe(404);
  });

  it('returns UNAVAILABILITY_ALREADY_STARTED when startDate is today or in the past', async () => {
    const { handler, repository } = buildHandler({ repository: { findUnavailabilityById: vi.fn().mockResolvedValue({ ...FUTURE_RECORD, startDate: '2026-08-01' }) } });
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNAVAILABILITY_ALREADY_STARTED');
    expect(repository.deleteUnavailability).not.toHaveBeenCalled();
  });

  it('on success: deletes and audits', async () => {
    const { handler, auditRecorder } = buildHandler();
    const result = await handler.execute(BASE_INPUT);
    expect(result.ok).toBe(true);
    expect(auditRecorder.recordChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted', entityId: 'unavail-1' }));
  });
});
