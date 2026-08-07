import type { AuthenticatedRoleCode } from '@campuscare/shared-types';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { AuthorizationError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isValidReason } from '../domain/validation.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';
import { roleNotAssignableError } from './role-errors.js';
import { accountNotFoundError } from './update-account-admin.handler.js';

export interface GrantRoleCommandInput {
  readonly userId: string;
  readonly roleCode: AuthenticatedRoleCode;
  readonly reason: string;
  readonly actorId: string;
  readonly correlationId: string;
}

/**
 * `POST /api/v1/users/{id}/roles` (API §1.4, FR-AUTH-03, PRM-13, BR-03).
 * Granting `CNP` never by itself grants counseling access (ADR-012) — the
 * vault's own roster is a second, independent authority this endpoint has
 * no credential to touch, which is the entire point of NFR-SEC-06's split.
 */
export class GrantRoleHandler {
  constructor(
    private readonly repository: AccountAdminRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: GrantRoleCommandInput): Promise<Result<AccountDetail, ValidationError | DomainRuleViolation | AuthorizationError>> {
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Minimum 10 characters after trimming' }],
        }),
      );
    }
    if (input.roleCode === 'STU') {
      return err(roleNotAssignableError('roleCode', 'Student accounts are provisioned by SSO, not this endpoint'));
    }

    const account = await this.repository.findAccountDetailById(input.userId);
    if (account === null) return err(accountNotFoundError());

    if (input.roleCode === 'CNP' && !account.isClinicalStaff) {
      await this.auditRecorder.recordDenial({
        actorId: input.actorId,
        attemptedRole: 'ADM',
        resource: 'user-accounts-and-roles',
        operation: 'update',
        reason: 'ROLE_NOT_ASSIGNABLE',
        correlationId: input.correlationId,
      });
      return err(roleNotAssignableError('roleCode', 'CNP requires isClinicalStaff'));
    }

    const outcome = await this.repository.grantRole({ userId: input.userId, roleCode: input.roleCode, grantedBy: input.actorId });
    if (outcome.outcome === 'not_found') return err(accountNotFoundError());
    if (outcome.outcome === 'already_held') {
      return err(new DomainRuleViolation({ code: 'ROLE_ALREADY_HELD', message: 'This account already has that role.' }));
    }

    await this.auditRecorder.recordChange({
      entityType: 'identity.user_role',
      entityId: input.userId,
      action: 'granted',
      afterState: { roleCode: input.roleCode, reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.account);
  }
}
