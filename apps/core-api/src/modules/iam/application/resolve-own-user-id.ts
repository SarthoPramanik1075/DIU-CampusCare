import type { FastifyRequest } from 'fastify';

import { AuthorizationError } from '../../../kernel/errors/domain-error.js';

import type { GetSessionQuery } from './queries/get-session.query.js';
import { SESSION_COOKIE_NAME } from './resolve-authenticated-subject.js';

export function unauthenticatedError(): AuthorizationError {
  return new AuthorizationError({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.', httpStatus: 401 });
}

/**
 * The PEP's `resolveSubject` only carries roles and account status (what
 * the PDP needs) — every PEP-gated route that also needs "who, specifically,
 * is asking" (own-profile, and now account-administration's actor id for
 * audit entries) reads it directly from the session, the same way
 * `logout`/`session` in `auth.routes.ts` do, rather than threading it
 * through `AuthorizationSubject`.
 */
export async function resolveOwnUserId(request: FastifyRequest, getSession: GetSessionQuery): Promise<string> {
  const sessionId = request.cookies[SESSION_COOKIE_NAME];
  const session = sessionId === undefined ? null : await getSession.execute(sessionId);
  if (session === null) throw unauthenticatedError();
  return session.userId;
}
