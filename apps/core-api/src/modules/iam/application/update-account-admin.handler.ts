import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isNonEmptyAfterTrim } from '../domain/validation.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';

export interface UpdateAccountAdminCommandInput {
  readonly userId: string;
  readonly fullName: string | undefined;
  readonly isClinicalStaff: boolean | undefined;
  readonly locationId: string | null | undefined;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export function accountNotFoundError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That account could not be found.', httpStatus: 404 });
}

/**
 * `PATCH /api/v1/users/{id}` (API §1.3). `status` and `roles` are
 * deliberately not accepted here — the lifecycle actions below (suspend/
 * activate/deactivate/role grant/revoke) exist specifically so each
 * transition carries its own rule, audit entry and side effects
 * (FR-AUTH-10); the route rejects those fields as `FIELD_NOT_EDITABLE`
 * before this handler ever runs, mirroring `PATCH /me`'s own split.
 */
export class UpdateAccountAdminHandler {
  constructor(
    private readonly repository: AccountAdminRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: UpdateAccountAdminCommandInput): Promise<Result<AccountDetail, ValidationError | ConflictError | AuthorizationError>> {
    if (input.fullName !== undefined && !isNonEmptyAfterTrim(input.fullName)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a full name.',
          fields: [{ field: 'fullName', rule: 'VALIDATION_FAILED', message: 'Non-empty after trimming' }],
        }),
      );
    }

    const outcome = await this.repository.updateAccountAdmin({
      userId: input.userId,
      fullName: input.fullName?.trim(),
      isClinicalStaff: input.isClinicalStaff,
      locationId: input.locationId,
      expectedVersion: input.expectedVersion,
      now: this.clock.now(),
    });

    if (outcome.outcome === 'not_found') return err(accountNotFoundError());

    if (outcome.outcome === 'stale') {
      const current = await this.repository.findAccountDetailById(input.userId);
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else updated this a moment ago. Here is the current version — review it and try again.',
          ...(current === null ? {} : { details: { current } }),
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'identity.user_account',
      entityId: input.userId,
      action: 'admin_updated',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.account);
  }
}
