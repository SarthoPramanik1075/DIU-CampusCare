import { toBstIsoString } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';

import { AuthorizationError, ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import type { LoginWithPasswordHandler } from '../../application/login-with-password.handler.js';
import type { LogoutHandler } from '../../application/logout.handler.js';
import type { GetSessionQuery } from '../../application/queries/get-session.query.js';
import { SESSION_COOKIE_NAME } from '../../application/resolve-authenticated-subject.js';

export interface AuthRouteDeps {
  readonly loginWithPassword: LoginWithPasswordHandler;
  readonly logout: LogoutHandler;
  readonly getSession: GetSessionQuery;
  readonly cookieSecure: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * API §1.1/§1.3–1.5. `login`/`logout`/`session` are deliberately not routed
 * through the resource+action PEP (`policy-enforcement-point.ts`): that
 * mechanism decides *what a known subject may do to a resource*, and these
 * three endpoints are where a subject becomes known in the first place —
 * `login` runs with no session at all, and `logout`/`session` only need
 * "is there a valid one", never a permission-matrix lookup.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = request.body as { email?: unknown; password?: unknown };
    if (!isNonEmptyString(body.email) || !isNonEmptyString(body.password)) {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Enter your email address and password.',
        fields: [
          ...(isNonEmptyString(body.email) ? [] : [{ field: 'email', rule: 'VR-01', message: 'Required' }]),
          ...(isNonEmptyString(body.password) ? [] : [{ field: 'password', rule: 'VR-02', message: 'Required' }]),
        ],
      });
    }

    const result = await deps.loginWithPassword.execute({
      email: body.email,
      password: body.password,
      sourceAddress: request.ip,
      correlationId: getCorrelationId(request),
    });

    if (!result.ok) throw result.error;
    const session = result.value;

    reply.setCookie(SESSION_COOKIE_NAME, session.sessionId, {
      httpOnly: true,
      secure: deps.cookieSecure,
      sameSite: 'lax',
      path: '/',
    });

    return {
      userId: session.userId,
      fullName: session.fullName,
      roles: session.roles,
      csrfToken: session.csrfToken,
      sessionExpiresAt: toBstIsoString(session.sessionExpiresAt),
      idleTimeoutMinutes: session.idleTimeoutMinutes,
    };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (sessionId !== undefined) {
      // "Logging out twice is not an error" (API §1.4) — if the session is
      // already gone, there is nothing to revoke and nothing meaningful to
      // audit; only a genuinely-still-valid session does either.
      const snapshot = await deps.getSession.execute(sessionId);
      if (snapshot !== null) {
        await deps.logout.execute({
          sessionId,
          userAccountId: snapshot.userId,
          correlationId: getCorrelationId(request),
        });
      }
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.status(204);
  });

  app.get('/api/v1/auth/session', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    const session = sessionId === undefined ? null : await deps.getSession.execute(sessionId);

    if (session === null) {
      throw new AuthorizationError({
        code: 'UNAUTHENTICATED',
        message: 'Sign in to continue.',
        httpStatus: 401,
      });
    }

    reply.header('Cache-Control', 'no-store');
    return {
      userId: session.userId,
      fullName: session.fullName,
      email: session.email,
      roles: session.roles,
      csrfToken: session.csrfToken,
      sessionExpiresAt: toBstIsoString(session.sessionExpiresAt),
    };
  });
}
