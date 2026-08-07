import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { canActivate } from '../domain/user-account.js';
import { isValidReason } from '../domain/validation.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';
import { accountNotFoundError } from './update-account-admin.handler.js';

export interface ActivateAccountInput {
  readonly userId: string;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

/**
 * `POST /api/v1/users/{id}/activate` (API §1.3, FR-AUTH-10). Reactivating a
 * `deactivated` account is explicitly permitted (`canActivate` documents
 * why) and audited as such; it does not restore anything the deactivation
 * cancelled.
 */
export class ActivateAccountHandler {
  constructor(
    private readonly repository: AccountAdminRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: ActivateAccountInput): Promise<Result<AccountDetail, ValidationError | ConflictError | DomainRuleViolation | AuthorizationError>> {
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Minimum 10 characters after trimming' }],
        }),
      );
    }

    const current = await this.repository.findAccountDetailById(input.userId);
    if (current === null) return err(accountNotFoundError());
    if (!canActivate(current.status)) {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'This account is already active.' }));
    }

    const outcome = await this.repository.transitionStatus({
      userId: input.userId,
      newStatus: 'active',
      expectedVersion: input.expectedVersion,
      now: this.clock.now(),
    });

    if (outcome.outcome === 'not_found') return err(accountNotFoundError());
    if (outcome.outcome === 'stale') {
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else updated this a moment ago. Here is the current version — review it and try again.',
          details: { current },
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'identity.user_account',
      entityId: input.userId,
      action: current.status === 'deactivated' ? 'reactivated_from_deactivated' : 'activated',
      afterState: { reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.account);
  }
}
