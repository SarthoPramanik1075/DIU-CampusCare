import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuditRecorder } from '../audit/audit-recorder.js';
import { AuthorizationError } from '../errors/domain-error.js';
import { getCorrelationId } from '../http/correlation.js';
import { resolveAnonymousSubject } from '../identity/subject-resolver.js';

import type { CoreResourceName, PermissionAction } from './permission-matrix.js';
import type { PolicyDecisionPoint } from './policy-decision-point.js';

/**
 * The Policy Enforcement Point — ARCHITECTURE §6.2 places this file at
 * exactly this path (`kernel/authz/policy-enforcement-point.ts`). It is the
 * Fastify-facing half of authorization; {@link PolicyDecisionPoint} is the
 * framework-free half it calls. Splitting them is what makes the PDP
 * testable with no server running (`policy-decision-point.test.ts`) while
 * this file carries everything that is unavoidably HTTP-shaped: reading the
 * request, writing the PRM-12 denial log, and raising the error the mapper
 * turns into a response.
 *
 * Every route declares its `resource` and `action` explicitly where it is
 * registered — there is no default. A route that forgets is a route that
 * cannot compile against this function's required parameter, which is
 * PRM-02 ("deny by default") enforced one step earlier than a runtime
 * check: the omission is a build error, not a live gap.
 */
export interface AuthorizationRouteConfig {
  readonly resource: CoreResourceName;
  readonly action: PermissionAction;
}

/**
 * A plain two-argument async function, deliberately typed without Fastify's
 * own `preHandlerHookHandler` — that type declares a `this: FastifyInstance`
 * parameter, which is exactly right for how Fastify invokes a preHandler at
 * request time but makes the function painful to call directly in a unit
 * test (`policy-enforcement-point.test.ts` calls it as a plain function,
 * with no Fastify instance to bind `this` to). Fastify accepts this simpler
 * shape as one of its documented preHandler signatures, so nothing is lost
 * at the registration call site.
 */
export type PolicyEnforcementHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function createPolicyEnforcementPoint(deps: {
  readonly pdp: PolicyDecisionPoint;
  readonly auditRecorder: AuditRecorder;
}): (config: AuthorizationRouteConfig) => PolicyEnforcementHandler {
  return (config) =>
    async function policyEnforcementPoint(request, _reply) {
      // Until M1 exists every request is anonymous — see the resolver's own
      // doc comment. This call site is where a real cookie-based subject
      // will be substituted in; nothing else in this function changes.
      const subject = resolveAnonymousSubject();

      const decision = await deps.pdp.decide({
        subject,
        resource: config.resource,
        action: config.action,
      });

      if (decision.permit) return;

      await deps.auditRecorder.recordDenial({
        attemptedRole: subject.roles.at(-1) ?? null,
        resource: config.resource,
        operation: config.action,
        reason: decision.reasonCode,
        correlationId: getCorrelationId(request),
      });

      throw new AuthorizationError({
        code: decision.reasonCode,
        message: decision.message,
        httpStatus: 403,
      });
    };
}
