import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { canSuspend } from '../domain/user-account.js';
import { isValidReason } from '../domain/validation.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';
import { accountNotFoundError } from './update-account-admin.handler.js';

export interface SuspendAccountInput {
  readonly userId: string;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

/**
 * `POST /api/v1/users/{id}/suspend` (API §1.3, FR-AUTH-10, BR-06). Revokes
 * every live session for the account immediately — a suspended account
 * cannot sign in, and an existing session must not let it keep acting as
 * though it still can (the same NFR-SEC-08 reasoning as a password reset).
 */
export class SuspendAccountHandler {
  constructor(
    private readonly repository: AccountAdminRepository,
    private readonly sessionStore: SessionStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: SuspendAccountInput): Promise<Result<AccountDetail, ValidationError | ConflictError | DomainRuleViolation | AuthorizationError>> {
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
    if (!canSuspend(current.status)) {
      // Unlike activate/deactivate, canSuspend has two invalid source
      // statuses (already-suspended and deactivated) — API §1.3's own
      // error table only writes the message for the deactivated case, so
      // the already-suspended case needs its own accurate wording rather
      // than reusing it.
      return err(
        new DomainRuleViolation({
          code: 'INVALID_STATUS_TRANSITION',
          message: current.status === 'suspended' ? 'This account is already suspended.' : 'This account is already deactivated.',
        }),
      );
    }

    const outcome = await this.repository.transitionStatus({
      userId: input.userId,
      newStatus: 'suspended',
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

    await this.sessionStore.revokeAllForUser(input.userId);
    await this.auditRecorder.recordChange({
      entityType: 'identity.user_account',
      entityId: input.userId,
      action: 'suspended',
      afterState: { reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.account);
  }
}
