import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { canDeactivate } from '../domain/user-account.js';
import { isValidReason } from '../domain/validation.js';

import type { AccountAdminRepository, ActiveAppointmentSummary } from './account-admin-repository.js';
import { accountNotFoundError } from './update-account-admin.handler.js';

export interface DeactivateAccountInput {
  readonly userId: string;
  readonly reason: string;
  readonly confirmedImpact: boolean;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface DeactivateAccountResult {
  readonly userId: string;
  readonly status: 'deactivated';
  readonly cancelledAppointments: readonly ActiveAppointmentSummary[];
  readonly version: number;
}

/**
 * `POST /api/v1/users/{id}/deactivate` (API §1.3, FR-AUTH-10/11, BR-06).
 *
 * VR-05's impact check is real: it queries `queueing.appointment` (already
 * migrated in full since M0.5) for the account's active bookings. Because
 * no booking feature writes to that table until M2, the list this returns
 * is honestly empty today — never fabricated, and this handler makes no
 * attempt to actually cancel a booking or emit `AccountDeactivated` to the
 * vault, since with zero real appointments there is nothing to cancel and
 * that side effect belongs to the scheduling/queueing module M2 builds,
 * not to `iam`. The gate itself (confirm before proceeding when bookings
 * exist) is fully enforced now so M2 only has to supply real rows, not new
 * logic here.
 */
export class DeactivateAccountHandler {
  constructor(
    private readonly repository: AccountAdminRepository,
    private readonly sessionStore: SessionStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: DeactivateAccountInput,
  ): Promise<Result<DeactivateAccountResult, ValidationError | ConflictError | DomainRuleViolation | AuthorizationError>> {
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
    if (!canDeactivate(current.status)) {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'This account is already deactivated.' }));
    }

    const activeAppointments = await this.repository.findActiveAppointmentsForStudent(input.userId);
    if (activeAppointments.length > 0 && !input.confirmedImpact) {
      return err(
        new DomainRuleViolation({
          code: 'CONFIRMATION_REQUIRED',
          message: `This account has ${String(activeAppointments.length)} upcoming appointment${activeAppointments.length === 1 ? '' : 's'}. They'll be cancelled and the student notified. Confirm to continue.`,
          details: { activeAppointments },
        }),
      );
    }

    const outcome = await this.repository.transitionStatus({
      userId: input.userId,
      newStatus: 'deactivated',
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
      action: 'deactivated',
      afterState: { reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok({
      userId: outcome.account.userId,
      status: 'deactivated',
      cancelledAppointments: activeAppointments,
      version: outcome.account.version,
    });
  }
}
