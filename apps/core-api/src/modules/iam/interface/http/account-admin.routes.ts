import { isRoleCode, toBstIsoString, type AuthenticatedRoleCode } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';

import type {
  AuthorizationRouteConfig,
  PolicyEnforcementHandler,
} from '../../../../kernel/authz/policy-enforcement-point.js';
import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import type { AccountDetail, AccountListItem } from '../../application/account-admin-repository.js';
import type { ActivateAccountHandler } from '../../application/activate-account.handler.js';
import type { CreateAccountHandler } from '../../application/create-account.handler.js';
import type { DeactivateAccountHandler } from '../../application/deactivate-account.handler.js';
import type { GetAccountDetailQuery } from '../../application/queries/get-account-detail.query.js';
import type { GetSessionQuery } from '../../application/queries/get-session.query.js';
import type { ListAccountsQuery } from '../../application/queries/list-accounts.query.js';
import { resolveOwnUserId } from '../../application/resolve-own-user-id.js';
import type { SuspendAccountHandler } from '../../application/suspend-account.handler.js';
import { accountNotFoundError, type UpdateAccountAdminHandler } from '../../application/update-account-admin.handler.js';

export interface AccountAdminRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly listAccounts: ListAccountsQuery;
  readonly getAccountDetail: GetAccountDetailQuery;
  readonly createAccount: CreateAccountHandler;
  readonly updateAccountAdmin: UpdateAccountAdminHandler;
  readonly suspendAccount: SuspendAccountHandler;
  readonly activateAccount: ActivateAccountHandler;
  readonly deactivateAccount: DeactivateAccountHandler;
}

/** API §1.3: `status` and `roles` change only through the lifecycle/role endpoints. */
const NON_EDITABLE_ADMIN_FIELDS = ['status', 'roles'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidRoleList(value: unknown): value is AuthenticatedRoleCode[] {
  return Array.isArray(value) && value.length > 0 && value.every((role) => isRoleCode(role) && role !== 'ANON');
}

function accountListItemDto(item: AccountListItem) {
  return {
    userId: item.userId,
    email: item.email,
    fullName: item.fullName,
    status: item.status,
    roles: item.roles,
    studentRef: item.studentRef,
    createdAt: toBstIsoString(item.createdAt),
    version: item.version,
  };
}

/**
 * API §1.3's own `GET /users/{id}` example lists exactly nine fields and
 * omits `isClinicalStaff` even though `PATCH /users/{id}` accepts it as a
 * write — an Administrator setting it cannot see the current value back
 * through this endpoint. Followed exactly as documented rather than
 * silently extending the wire shape; `AccountDetail.isClinicalStaff` still
 * exists on the domain object because the VR-04 `CNP`-grant gate needs it.
 */
function accountDetailDto(account: AccountDetail) {
  return {
    userId: account.userId,
    email: account.email,
    fullName: account.fullName,
    status: account.status,
    authMethod: account.authMethod,
    roles: account.roles.map((role) => ({ code: role.code, grantedBy: role.grantedBy, grantedAt: toBstIsoString(role.grantedAt) })),
    studentProfile: account.studentProfile,
    lockedUntil: account.lockedUntil === null ? null : toBstIsoString(account.lockedUntil),
    lastLoginAt: account.lastLoginAt === null ? null : toBstIsoString(account.lastLoginAt),
    version: account.version,
  };
}

/** API §1.3 — all `Session + Role(ADM)`, enforced by the PEP against the `user-accounts-and-roles` resource (`scope: 'any'`, no ownership evaluator needed). */
export function registerAccountAdminRoutes(app: FastifyInstance, deps: AccountAdminRouteDeps): void {
  app.get(
    '/api/v1/users',
    { preHandler: deps.pep({ resource: 'user-accounts-and-roles', action: 'read' }) },
    async (request) => {
      const query = request.query as { q?: unknown; status?: unknown; role?: unknown; limit?: unknown; cursor?: unknown };
      const result = await deps.listAccounts.execute({
        ...(typeof query.q === 'string' ? { q: query.q } : {}),
        ...(isAccountStatus(query.status) ? { status: query.status } : {}),
        ...(isRoleCode(query.role) && query.role !== 'ANON' ? { role: query.role } : {}),
        ...(typeof query.limit === 'string' ? { limit: Number.parseInt(query.limit, 10) } : {}),
        ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
      });
      if (!result.ok) throw result.error;
      return { items: result.value.items.map(accountListItemDto), nextCursor: result.value.nextCursor };
    },
  );

  app.post(
    '/api/v1/users',
    { preHandler: deps.pep({ resource: 'user-accounts-and-roles', action: 'create' }) },
    async (request, reply) => {
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as {
        email?: unknown;
        fullName?: unknown;
        authMethod?: unknown;
        roles?: unknown;
        isClinicalStaff?: unknown;
        locationId?: unknown;
      };

      const roles = isValidRoleList(body.roles) ? body.roles : null;

      if (!isNonEmptyString(body.email) || !isNonEmptyString(body.fullName) || (body.authMethod !== 'sso' && body.authMethod !== 'local') || roles === null) {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Check the account details and try again.',
          fields: [
            ...(isNonEmptyString(body.email) ? [] : [{ field: 'email', rule: 'VR-01', message: 'Required' }]),
            ...(isNonEmptyString(body.fullName) ? [] : [{ field: 'fullName', rule: 'VALIDATION_FAILED', message: 'Required' }]),
            ...(body.authMethod === 'sso' || body.authMethod === 'local'
              ? []
              : [{ field: 'authMethod', rule: 'VALIDATION_FAILED', message: 'Must be "sso" or "local"' }]),
            ...(roles === null ? [{ field: 'roles', rule: 'VALIDATION_FAILED', message: 'Must be an array of valid role codes' }] : []),
          ],
        });
      }

      const result = await deps.createAccount.execute({
        email: body.email,
        fullName: body.fullName,
        authMethod: body.authMethod,
        roles,
        isClinicalStaff: body.isClinicalStaff === true,
        locationId: typeof body.locationId === 'string' ? body.locationId : null,
        createdBy: actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;

      reply.status(201);
      return accountDetailDto(result.value);
    },
  );

  app.get(
    '/api/v1/users/:id',
    { preHandler: deps.pep({ resource: 'user-accounts-and-roles', action: 'read' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const account = await deps.getAccountDetail.execute({ userId: id, accessorId: actorId, correlationId: getCorrelationId(request) });
      if (account === null) throw accountNotFoundError();
      return accountDetailDto(account);
    },
  );

  app.patch(
    '/api/v1/users/:id',
    { preHandler: deps.pep({ resource: 'user-accounts-and-roles', action: 'update' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as Record<string, unknown>;

      const forbiddenFields = NON_EDITABLE_ADMIN_FIELDS.filter((field) => field in body);
      if (forbiddenFields.length > 0) {
        throw new ValidationError({
          code: 'FIELD_NOT_EDITABLE',
          message: 'Use the account status or role actions to change that.',
          fields: forbiddenFields.map((field) => ({ field, rule: 'PRM-13', message: 'Not editable via this endpoint' })),
        });
      }
      if (typeof body.version !== 'number') {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Include the current version with your update.',
          fields: [{ field: 'version', rule: 'VR-92', message: 'Required' }],
        });
      }

      const result = await deps.updateAccountAdmin.execute({
        userId: id,
        fullName: typeof body.fullName === 'string' ? body.fullName : undefined,
        isClinicalStaff: typeof body.isClinicalStaff === 'boolean' ? body.isClinicalStaff : undefined,
        locationId: 'locationId' in body ? (body.locationId as string | null) : undefined,
        expectedVersion: body.version,
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;
      return accountDetailDto(result.value);
    },
  );

  app.post(
    '/api/v1/users/:id/suspend',
    { preHandler: deps.pep({ resource: 'user-accounts-and-roles', action: 'update' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as { reason?: unknown; version?: unknown };
      requireReasonAndVersion(body);

      const result = await deps.suspendAccount.execute({
        userId: id,
        reason: body.reason,
        expectedVersion: body.version,
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;
      return accountDetailDto(result.value);
    },
  );

  app.post(
    '/api/v1/users/:id/activate',
    { preHandler: deps.pep({ resource: 'user-accounts-and-roles', action: 'update' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as { reason?: unknown; version?: unknown };
      requireReasonAndVersion(body);

      const result = await deps.activateAccount.execute({
        userId: id,
        reason: body.reason,
        expectedVersion: body.version,
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;
      return accountDetailDto(result.value);
    },
  );

  app.post(
    '/api/v1/users/:id/deactivate',
    { preHandler: deps.pep({ resource: 'user-accounts-and-roles', action: 'update' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as { reason?: unknown; confirmedImpact?: unknown; version?: unknown };
      requireReasonAndVersion(body);

      const result = await deps.deactivateAccount.execute({
        userId: id,
        reason: body.reason,
        confirmedImpact: body.confirmedImpact === true,
        expectedVersion: body.version,
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;
      return result.value;
    },
  );
}

function requireReasonAndVersion<T extends { reason?: unknown; version?: unknown }>(
  body: T,
): asserts body is T & { reason: string; version: number } {
  if (!isNonEmptyString(body.reason) || typeof body.version !== 'number') {
    throw new ValidationError({
      code: 'VALIDATION_FAILED',
      message: 'Enter a reason and include the current version.',
      fields: [
        ...(isNonEmptyString(body.reason) ? [] : [{ field: 'reason', rule: 'VR-93', message: 'Required' }]),
        ...(typeof body.version === 'number' ? [] : [{ field: 'version', rule: 'VR-92', message: 'Required' }]),
      ],
    });
  }
}

function isAccountStatus(value: unknown): value is 'pending' | 'active' | 'suspended' | 'deactivated' {
  return value === 'pending' || value === 'active' || value === 'suspended' || value === 'deactivated';
}
