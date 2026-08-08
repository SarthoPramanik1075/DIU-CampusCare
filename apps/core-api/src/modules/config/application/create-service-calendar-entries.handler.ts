import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { enumerateDates, isNonEmptyReason, isValidDateOrder, rangeDaysInclusive } from '../domain/service-calendar.js';
import type { ServiceCalendarEntry } from '../domain/service-calendar.js';

import type { ConflictingSession, ServiceCalendarRepository } from './service-calendar-repository.js';

const MAX_RANGE_DAYS = 366;

export interface CreateServiceCalendarEntriesInput {
  readonly fromDate: string;
  readonly toDate: string;
  readonly isServiceDay: boolean;
  readonly reason: string;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface CreateServiceCalendarEntriesResult {
  readonly created: number;
  readonly items: readonly ServiceCalendarEntry[];
  readonly conflictingSessions: readonly ConflictingSession[];
}

/** `POST /api/v1/service-calendar` (API §8.4, FR-SCH-10, FR-ADM-03, BR-28). Creating a closure never cancels sessions — that would bypass FR-SCH-07's impact preview (§3.4). */
export class CreateServiceCalendarEntriesHandler {
  constructor(
    private readonly repository: ServiceCalendarRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: CreateServiceCalendarEntriesInput): Promise<Result<CreateServiceCalendarEntriesResult, ValidationError | DomainRuleViolation>> {
    if (!isValidDateOrder(input.fromDate, input.toDate) || rangeDaysInclusive(input.fromDate, input.toDate) > MAX_RANGE_DAYS) {
      return err(
        new ValidationError({
          code: 'INVALID_DATE_RANGE',
          message: 'Choose a date range within one year.',
          fields: [{ field: 'toDate', rule: 'API §8.4', message: 'Must be on/after fromDate, within 366 days' }],
        }),
      );
    }
    if (!isNonEmptyReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason for this calendar entry.',
          fields: [{ field: 'reason', rule: 'API §8.4', message: 'Required' }],
        }),
      );
    }

    const locationId = await this.repository.findDefaultLocationId();
    const dates = enumerateDates(input.fromDate, input.toDate);
    const outcome = await this.repository.createEntries(locationId, dates, input.isServiceDay, input.reason, input.actorId);

    if (outcome.outcome === 'conflict') {
      return err(
        new DomainRuleViolation({
          code: 'CALENDAR_ENTRY_EXISTS',
          message: `${outcome.conflictingDate} is already marked in the calendar. Edit that entry instead.`,
          details: { conflictingDate: outcome.conflictingDate },
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'config.service_calendar',
      entityId: outcome.items[0]?.id ?? null,
      action: 'created',
      afterState: { fromDate: input.fromDate, toDate: input.toDate, isServiceDay: input.isServiceDay, reason: input.reason, count: outcome.items.length },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok({ created: outcome.items.length, items: outcome.items, conflictingSessions: outcome.conflictingSessions });
  }
}
