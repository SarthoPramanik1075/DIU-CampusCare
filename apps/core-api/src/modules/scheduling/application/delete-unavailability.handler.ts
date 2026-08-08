import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isValidReason } from '../domain/validation.js';

import type { UnavailabilityRepository } from './unavailability-repository.js';

export interface DeleteUnavailabilityInput {
  readonly unavailabilityId: string;
  readonly reason: string;
  readonly actorId: string;
  readonly correlationId: string;
}

function unavailabilityNotFoundError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That leave period could not be found.', httpStatus: 404 });
}

/**
 * `DELETE /api/v1/unavailability/{id}` (API §3.4, FR-SCH-06). Bookings
 * already cancelled under this leave are not restored — staff or
 * students rebook manually, since restoring them silently would be
 * worse than leaving them cancelled.
 */
export class DeleteUnavailabilityHandler {
  constructor(
    private readonly repository: UnavailabilityRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: DeleteUnavailabilityInput): Promise<Result<void, ValidationError | DomainRuleViolation | AuthorizationError>> {
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Required' }],
        }),
      );
    }

    const record = await this.repository.findUnavailabilityById(input.unavailabilityId);
    if (record === null) return err(unavailabilityNotFoundError());

    const today = this.clock.now().toISOString().slice(0, 10);
    if (record.startDate <= today) {
      return err(new DomainRuleViolation({ code: 'UNAVAILABILITY_ALREADY_STARTED', message: "This leave period has already started and can't be removed." }));
    }

    const outcome = await this.repository.deleteUnavailability(input.unavailabilityId);
    if (outcome === 'not_found') return err(unavailabilityNotFoundError());

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.doctor_unavailability',
      entityId: input.unavailabilityId,
      action: 'deleted',
      afterState: { reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(undefined);
  }
}
