import type { FastifyInstance, FastifyRequest } from 'fastify';

import type {
  AuthorizationRouteConfig,
  PolicyEnforcementHandler,
} from '../../../../kernel/authz/policy-enforcement-point.js';
import { AuthorizationError, ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import type { GetOwnProfileQuery } from '../../application/queries/get-own-profile.query.js';
import type { GetSessionQuery } from '../../application/queries/get-session.query.js';
import { SESSION_COOKIE_NAME } from '../../application/resolve-authenticated-subject.js';
import type { UpdateOwnProfileHandler } from '../../application/update-own-profile.handler.js';

export interface OwnProfileRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly getOwnProfile: GetOwnProfileQuery;
  readonly updateOwnProfile: UpdateOwnProfileHandler;
}

/** API §1.2: `email`, `status`, `roles` and `studentRef` are not editable via `PATCH /me`. */
const NON_EDITABLE_FIELDS = ['email', 'status', 'roles', 'studentRef'] as const;

function unauthenticatedError(): AuthorizationError {
  return new AuthorizationError({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.', httpStatus: 401 });
}

/**
 * The PEP's `resolveSubject` only carries roles and account status (what
 * the PDP needs) — the route still needs the caller's own account id, the
 * same way `logout`/`session` in `auth.routes.ts` read it directly from the
 * session rather than threading it through `AuthorizationSubject`.
 */
async function resolveOwnUserId(request: FastifyRequest, getSession: GetSessionQuery): Promise<string> {
  const sessionId = request.cookies[SESSION_COOKIE_NAME];
  const session = sessionId === undefined ? null : await getSession.execute(sessionId);
  if (session === null) throw unauthenticatedError();
  return session.userId;
}

/**
 * API §1.2 `GET/PATCH /api/v1/me`. `own-profile`'s permission-matrix scope
 * is `'own'`, but there is no separate resource id here to compare against
 * the subject — the resource *is* "whichever account the session belongs
 * to" — so the ownership evaluator this module supplies is unconditionally
 * true rather than a real comparison (contrast a future `appointment-own`
 * route, where `isOwner` will check `appointment.student_id`).
 */
export function registerOwnProfileRoutes(app: FastifyInstance, deps: OwnProfileRouteDeps): void {
  app.get(
    '/api/v1/me',
    { preHandler: deps.pep({ resource: 'own-profile', action: 'read', isOwner: () => () => true }) },
    async (request) => {
      const userId = await resolveOwnUserId(request, deps.getSession);
      const profile = await deps.getOwnProfile.execute(userId);
      if (profile === null) throw unauthenticatedError();
      return profile;
    },
  );

  app.patch(
    '/api/v1/me',
    { preHandler: deps.pep({ resource: 'own-profile', action: 'update', isOwner: () => () => true }) },
    async (request) => {
      const userId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as Record<string, unknown>;

      const forbiddenFields = NON_EDITABLE_FIELDS.filter((field) => field in body);
      if (forbiddenFields.length > 0) {
        throw new ValidationError({
          code: 'FIELD_NOT_EDITABLE',
          message: "That detail can't be changed here. Contact DIU IT if it's wrong.",
          fields: forbiddenFields.map((field) => ({
            field,
            rule: 'PRM-13',
            message: 'Not editable via this endpoint',
          })),
        });
      }

      if (typeof body.version !== 'number') {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Include the current version with your update.',
          fields: [{ field: 'version', rule: 'VR-92', message: 'Required' }],
        });
      }
      if (body.fullName !== undefined && typeof body.fullName !== 'string') {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'fullName must be text.',
          fields: [{ field: 'fullName', rule: 'VR-92', message: 'Must be a string' }],
        });
      }

      const result = await deps.updateOwnProfile.execute({
        userAccountId: userId,
        fullName: body.fullName,
        expectedVersion: body.version,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;
      return result.value;
    },
  );
}
