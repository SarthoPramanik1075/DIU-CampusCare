import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { resolveAnonymousSubject } from '../identity/subject-resolver.js';

import type { AuthorizationDecision, AuthorizationSubject, PolicyDecisionPoint } from './policy-decision-point.js';
import { createPolicyEnforcementPoint } from './policy-enforcement-point.js';

function fakeRequest(correlationId: string): FastifyRequest {
  return { correlationId } as FastifyRequest;
}

function fakePdp(decision: AuthorizationDecision): PolicyDecisionPoint {
  return { decide: vi.fn().mockResolvedValue(decision) } as unknown as PolicyDecisionPoint;
}

const resolveSubject = () => Promise.resolve(resolveAnonymousSubject());
const resolveStudentSubject = (subject: Partial<AuthorizationSubject> = {}) =>
  (): Promise<AuthorizationSubject> => Promise.resolve({ roles: ['STU'], accountStatus: 'active', ...subject });

describe('createPolicyEnforcementPoint', () => {
  it('resolves without throwing when the decision permits', async () => {
    const pdp = fakePdp({ permit: true });
    const recordDenial = vi.fn();
    const pep = createPolicyEnforcementPoint({ pdp, auditRecorder: { recordDenial } as never, resolveSubject });

    const handler = pep({ resource: 'announcements', action: 'read' });
    await expect(
      handler(fakeRequest('corr-1'), {} as FastifyReply),
    ).resolves.toBeUndefined();
    expect(recordDenial).not.toHaveBeenCalled();
  });

  it('maps a denial of an anonymous subject to UNAUTHENTICATED (401), not a PRM-12 denial — API §0.5', async () => {
    const pdp = fakePdp({
      permit: false,
      reasonCode: 'NO_MATCHING_RULE',
      message: 'You do not have permission to do that.',
    });
    const recordDenial = vi.fn().mockResolvedValue(undefined);
    const pep = createPolicyEnforcementPoint({ pdp, auditRecorder: { recordDenial } as never, resolveSubject });

    const handler = pep({ resource: 'own-profile', action: 'read' });
    await expect(handler(fakeRequest('corr-2'), {} as FastifyReply)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      httpStatus: 401,
    });
    expect(recordDenial).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN and records a PRM-12 denial when a real, signed-in subject is denied', async () => {
    const pdp = fakePdp({
      permit: false,
      reasonCode: 'NO_MATCHING_RULE',
      message: 'You do not have permission to do that.',
    });
    const recordDenial = vi.fn().mockResolvedValue(undefined);
    const pep = createPolicyEnforcementPoint({
      pdp,
      auditRecorder: { recordDenial } as never,
      resolveSubject: resolveStudentSubject(),
    });

    const handler = pep({ resource: 'general-audit-log', action: 'read' });
    await expect(handler(fakeRequest('corr-3'), {} as FastifyReply)).rejects.toMatchObject({
      code: 'NO_MATCHING_RULE',
      httpStatus: 403,
    });

    expect(recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptedRole: 'STU',
        resource: 'general-audit-log',
        operation: 'read',
        reason: 'NO_MATCHING_RULE',
        correlationId: 'corr-3',
      }),
    );
  });

  it('maps an ACCOUNT_NOT_ACTIVE denial of a real, signed-in subject to that same error code', async () => {
    const pdp = fakePdp({ permit: false, reasonCode: 'ACCOUNT_NOT_ACTIVE', message: 'This account is not active.' });
    const pep = createPolicyEnforcementPoint({
      pdp,
      auditRecorder: { recordDenial: vi.fn().mockResolvedValue(undefined) } as never,
      resolveSubject: resolveStudentSubject({ accountStatus: 'suspended' }),
    });

    const handler = pep({ resource: 'own-profile', action: 'read' });
    await expect(handler(fakeRequest('corr-4'), {} as FastifyReply)).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_ACTIVE',
      httpStatus: 403,
    });
  });

  it('builds the ownership evaluator from the request and passes it to the PDP', async () => {
    const decide = vi.fn().mockResolvedValue({ permit: true });
    const pdp = { decide } as unknown as PolicyDecisionPoint;
    const pep = createPolicyEnforcementPoint({
      pdp,
      auditRecorder: { recordDenial: vi.fn() } as never,
      resolveSubject,
    });
    const request = fakeRequest('corr-4');
    const isOwnerThunk = () => true;
    const isOwner = vi.fn().mockReturnValue(isOwnerThunk);

    const handler = pep({ resource: 'own-profile', action: 'read', isOwner });
    await handler(request, {} as FastifyReply);

    expect(isOwner).toHaveBeenCalledWith(request);
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ isOwner: isOwnerThunk }));
  });

  it('omits isOwner from the PDP request entirely when the route supplies none', async () => {
    const decide = vi.fn().mockResolvedValue({ permit: true });
    const pdp = { decide } as unknown as PolicyDecisionPoint;
    const pep = createPolicyEnforcementPoint({
      pdp,
      auditRecorder: { recordDenial: vi.fn() } as never,
      resolveSubject,
    });

    const handler = pep({ resource: 'announcements', action: 'read' });
    await handler(fakeRequest('corr-5'), {} as FastifyReply);

    expect(decide).toHaveBeenCalledWith(expect.not.objectContaining({ isOwner: expect.anything() }));
  });
});
