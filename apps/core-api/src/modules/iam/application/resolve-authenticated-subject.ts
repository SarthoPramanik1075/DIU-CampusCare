import type { FastifyRequest } from 'fastify';

import type { AuthorizationSubject } from '../../../kernel/authz/policy-decision-point.js';
import { resolveAnonymousSubject, type SubjectResolver } from '../../../kernel/identity/subject-resolver.js';

import type { GetSessionQuery } from './queries/get-session.query.js';

/** API §0.2/§1.3: the session cookie every authenticated request carries. */
export const SESSION_COOKIE_NAME = 'ccc_session';

/**
 * The real implementation of the kernel's {@link SubjectResolver} seam —
 * wired into the PEP by the composition root (DR-1: the kernel itself
 * never imports this). No cookie, or a cookie `GetSessionQuery` cannot
 * resolve (unknown, expired, revoked, or the account is no longer active),
 * is ANON — API §0.4's "never confirm existence through an error" applies
 * here too: an invalid session and no session at all look identical to
 * every caller downstream of this function.
 */
export function createAuthenticatedSubjectResolver(getSessionQuery: GetSessionQuery): SubjectResolver {
  return async function resolveAuthenticatedSubject(request: FastifyRequest): Promise<AuthorizationSubject> {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (sessionId === undefined) return resolveAnonymousSubject();

    const session = await getSessionQuery.execute(sessionId);
    if (session === null) return resolveAnonymousSubject();

    return { roles: session.roles, accountStatus: 'active' };
  };
}
