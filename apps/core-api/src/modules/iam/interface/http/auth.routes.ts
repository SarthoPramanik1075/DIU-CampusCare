import { toBstIsoString } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';

import { AuthorizationError, ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import type { LoginWithPasswordHandler } from '../../application/login-with-password.handler.js';
import type { LogoutHandler } from '../../application/logout.handler.js';
import type { GetSessionQuery } from '../../application/queries/get-session.query.js';
import type { SsoLoginHandler } from '../../application/queries/sso-login.query.js';
import { SESSION_COOKIE_NAME } from '../../application/resolve-authenticated-subject.js';
import type { SsoCallbackHandler } from '../../application/sso-callback.handler.js';
import { defaultLandingPath } from '../../domain/default-landing-path.js';

export interface AuthRouteDeps {
  readonly loginWithPassword: LoginWithPasswordHandler;
  readonly logout: LogoutHandler;
  readonly getSession: GetSessionQuery;
  readonly ssoLogin: SsoLoginHandler;
  readonly ssoCallback: SsoCallbackHandler;
  readonly cookieSecure: boolean;
}

/** API §1.1/§1.2 — carries `{ state, codeVerifier, redirectTo }` across the IdP round trip. */
const SSO_PRESESSION_COOKIE_NAME = 'ccc_sso_presession';
const SSO_PRESESSION_MAX_AGE_SECONDS = 600;

interface SsoPreSession {
  readonly state: string;
  readonly codeVerifier: string;
  readonly redirectTo: string | undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function ssoStateMismatchError(): AuthorizationError {
  return new AuthorizationError({
    code: 'SSO_STATE_MISMATCH',
    message: "Your sign-in couldn't be completed. Start again from the sign-in page.",
    httpStatus: 403,
  });
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

  app.get('/api/v1/auth/sso/login', async (request, reply) => {
    const query = request.query as { redirectTo?: unknown };
    const redirectTo = typeof query.redirectTo === 'string' ? query.redirectTo : undefined;

    const result = await deps.ssoLogin.execute(redirectTo);
    if (!result.ok) throw result.error;
    const { redirectUrl, state, codeVerifier } = result.value;

    const preSession: SsoPreSession = { state, codeVerifier, redirectTo };
    reply.setCookie(SSO_PRESESSION_COOKIE_NAME, JSON.stringify(preSession), {
      httpOnly: true,
      secure: deps.cookieSecure,
      sameSite: 'lax',
      signed: true,
      path: '/api/v1/auth/sso',
      maxAge: SSO_PRESESSION_MAX_AGE_SECONDS,
    });

    return reply.redirect(redirectUrl);
  });

  app.get('/api/v1/auth/sso/callback', async (request, reply) => {
    const raw = request.cookies[SSO_PRESESSION_COOKIE_NAME];
    reply.clearCookie(SSO_PRESESSION_COOKIE_NAME, { path: '/api/v1/auth/sso' });

    if (raw === undefined) throw ssoStateMismatchError();
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid) throw ssoStateMismatchError();

    let preSession: SsoPreSession;
    try {
      preSession = JSON.parse(unsigned.value) as SsoPreSession;
    } catch {
      throw ssoStateMismatchError();
    }

    const query = request.query as { code?: unknown; state?: unknown };
    const callbackUrl = new URL(request.url, `${request.protocol}://${request.host}`);

    const result = await deps.ssoCallback.execute({
      callbackUrl,
      queryState: typeof query.state === 'string' ? query.state : undefined,
      preSessionState: preSession.state,
      codeVerifier: preSession.codeVerifier,
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

    return reply.redirect(preSession.redirectTo ?? defaultLandingPath(session.roles));
  });
}
