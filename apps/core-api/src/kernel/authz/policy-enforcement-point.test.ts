import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { AuthorizationDecision, PolicyDecisionPoint } from './policy-decision-point.js';
import { createPolicyEnforcementPoint } from './policy-enforcement-point.js';

function fakeRequest(correlationId: string): FastifyRequest {
  return { correlationId } as FastifyRequest;
}

function fakePdp(decision: AuthorizationDecision): PolicyDecisionPoint {
  return { decide: vi.fn().mockResolvedValue(decision) } as unknown as PolicyDecisionPoint;
}

describe('createPolicyEnforcementPoint', () => {
  it('resolves without throwing when the decision permits', async () => {
    const pdp = fakePdp({ permit: true });
    const recordDenial = vi.fn();
    const pep = createPolicyEnforcementPoint({ pdp, auditRecorder: { recordDenial } as never });

    const handler = pep({ resource: 'announcements', action: 'read' });
    await expect(
      handler(fakeRequest('corr-1'), {} as FastifyReply),
    ).resolves.toBeUndefined();
    expect(recordDenial).not.toHaveBeenCalled();
  });

  it('throws AuthorizationError and records a PRM-12 denial when the decision denies', async () => {
    const pdp = fakePdp({
      permit: false,
      reasonCode: 'NO_MATCHING_RULE',
      message: 'You do not have permission to do that.',
    });
    const recordDenial = vi.fn().mockResolvedValue(undefined);
    const pep = createPolicyEnforcementPoint({ pdp, auditRecorder: { recordDenial } as never });

    const handler = pep({ resource: 'general-audit-log', action: 'read' });
    await expect(handler(fakeRequest('corr-2'), {} as FastifyReply)).rejects.toMatchObject({
      code: 'NO_MATCHING_RULE',
      httpStatus: 403,
    });

    expect(recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptedRole: 'ANON',
        resource: 'general-audit-log',
        operation: 'read',
        reason: 'NO_MATCHING_RULE',
        correlationId: 'corr-2',
      }),
    );
  });

  it('maps an ACCOUNT_NOT_ACTIVE denial to that same error code', async () => {
    const pdp = fakePdp({ permit: false, reasonCode: 'ACCOUNT_NOT_ACTIVE', message: 'This account is not active.' });
    const pep = createPolicyEnforcementPoint({
      pdp,
      auditRecorder: { recordDenial: vi.fn().mockResolvedValue(undefined) } as never,
    });

    const handler = pep({ resource: 'own-profile', action: 'read' });
    await expect(handler(fakeRequest('corr-3'), {} as FastifyReply)).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_ACTIVE',
    });
  });
});
