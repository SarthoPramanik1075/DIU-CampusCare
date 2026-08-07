import type { AuthenticatedRoleCode } from '@campuscare/shared-types';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isValidReason } from '../domain/validation.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';
import { roleNotHeldError } from './role-errors.js';
import { accountNotFoundError } from './update-account-admin.handler.js';

export interface RevokeRoleCommandInput {
  readonly userId: string;
  readonly roleCode: AuthenticatedRoleCode;
  readonly reason: string;
  readonly actorId: string;
  readonly correlationId: string;
}

/**
 * `DELETE /api/v1/users/{id}/roles/{roleCode}` (API §1.4, PRM-13, PRM-15).
 * "Takes effect on the affected user's next request, with no
 * re-authentication required and no forced sign-out" — this is already
 * true by construction: the PDP re-derives roles from `identity.user_role`
 * on every request (see `GetSessionQuery`/`resolve-authenticated-subject`),
 * never from a cached session claim, so there is nothing extra to do here
 * to make a revocation take effect immediately.
 */
export class RevokeRoleHandler {
  constructor(
    private readonly repository: AccountAdminRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: RevokeRoleCommandInput): Promise<Result<AccountDetail, ValidationError | DomainRuleViolation | AuthorizationError>> {
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Minimum 10 characters after trimming' }],
        }),
      );
    }

    const outcome = await this.repository.revokeRole({ userId: input.userId, roleCode: input.roleCode, now: this.clock.now() });
    if (outcome.outcome === 'not_found') return err(accountNotFoundError());
    if (outcome.outcome === 'not_held') return err(roleNotHeldError());
    if (outcome.outcome === 'would_remove_last_admin') {
      return err(
        new DomainRuleViolation({
          code: 'LAST_ADMIN_ROLE',
          message: "You can't remove the last administrator. Give another account the Administrator role first.",
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'identity.user_role',
      entityId: input.userId,
      action: 'revoked',
      afterState: { roleCode: input.roleCode, reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.account);
  }
}
