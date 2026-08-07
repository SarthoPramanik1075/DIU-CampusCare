import type { FastifyRequest } from 'fastify';

import type { AuthorizationSubject } from '../authz/policy-decision-point.js';

/**
 * The ANON subject — every request the real resolver cannot authenticate
 * (no cookie, an invalid or expired session) resolves to this, never to an
 * error. Unauthenticated is a valid subject, not a failure to produce one.
 */
export function resolveAnonymousSubject(): AuthorizationSubject {
  return { roles: ['ANON'], accountStatus: null };
}

/**
 * The seam DR-1 requires: the kernel's PEP needs *a* way to turn a request
 * into a subject, but the actual lookup (cookie → session → account →
 * roles) is business logic that lives in `modules/iam`, which the kernel
 * may not import. The composition root wires IAM's real implementation
 * (`resolveAuthenticatedSubject`) into the PEP as this type; nothing in
 * `kernel/` ever calls it directly.
 */
export type SubjectResolver = (request: FastifyRequest) => Promise<AuthorizationSubject>;
