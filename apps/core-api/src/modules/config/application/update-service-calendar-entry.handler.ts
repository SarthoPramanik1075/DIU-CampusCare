import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { AuthorizationError, ConflictError, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isNonEmptyReason } from '../domain/service-calendar.js';
import type { ServiceCalendarEntry } from '../domain/service-calendar.js';

import type { ServiceCalendarRepository } from './service-calendar-repository.js';

export interface UpdateServiceCalendarEntryInput {
  readonly entryId: string;
  readonly isServiceDay: boolean | undefined;
  readonly reason: string | undefined;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export function serviceCalendarEntryNotFoundError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That calendar entry could not be found.', httpStatus: 404 });
}

/** `PATCH /api/v1/service-calendar/{id}` (API §8.5, FR-ADM-03). */
export class UpdateServiceCalendarEntryHandler {
  constructor(
    private readonly repository: ServiceCalendarRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: UpdateServiceCalendarEntryInput): Promise<Result<ServiceCalendarEntry, ValidationError | ConflictError | AuthorizationError>> {
    if (input.reason !== undefined && !isNonEmptyReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason for this calendar entry.',
          fields: [{ field: 'reason', rule: 'API §8.5', message: 'Non-empty when present' }],
        }),
      );
    }

    const outcome = await this.repository.updateEntry(input.entryId, { isServiceDay: input.isServiceDay, reason: input.reason, expectedVersion: input.expectedVersion });

    if (outcome.outcome === 'not_found') return err(serviceCalendarEntryNotFoundError());
    if (outcome.outcome === 'stale') {
      const current = await this.repository.findEntryById(input.entryId);
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else updated this a moment ago. Here is the current version — review it and try again.',
          ...(current === null ? {} : { details: { current } }),
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'config.service_calendar',
      entityId: input.entryId,
      action: 'updated',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.entry);
  }
}
