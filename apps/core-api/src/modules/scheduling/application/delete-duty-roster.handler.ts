import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { ValidationError, type AuthorizationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isValidReason } from '../domain/validation.js';

import type { DutyRosterRepository } from './duty-roster-repository.js';
import { dutyRosterNotFoundError } from './update-duty-roster.handler.js';

export interface DeleteDutyRosterInput {
  readonly rosterId: string;
  readonly reason: string;
  readonly actorId: string;
  readonly correlationId: string;
}

/** `DELETE /api/v1/duty-rosters/{id}` (API §3.2). Sets `is_active = false`; the row is retained (P4). */
export class DeleteDutyRosterHandler {
  constructor(
    private readonly repository: DutyRosterRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: DeleteDutyRosterInput): Promise<Result<undefined, ValidationError | AuthorizationError>> {
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Minimum 10 characters after trimming' }],
        }),
      );
    }

    const outcome = await this.repository.deleteDutyRoster(input.rosterId);
    if (outcome.outcome === 'not_found') return err(dutyRosterNotFoundError());

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.duty_roster',
      entityId: input.rosterId,
      action: 'deactivated',
      afterState: { reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(undefined);
  }
}
