import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, DomainRuleViolation } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';

import type { ServiceCalendarRepository } from './service-calendar-repository.js';
import { serviceCalendarEntryNotFoundError } from './update-service-calendar-entry.handler.js';

export interface DeleteServiceCalendarEntryInput {
  readonly entryId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

/** `DELETE /api/v1/service-calendar/{id}` (API §8.6, FR-ADM-03). Removing a past closure would rewrite the record of a day the centre was actually shut, so only a future entry may be removed. */
export class DeleteServiceCalendarEntryHandler {
  constructor(
    private readonly repository: ServiceCalendarRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: DeleteServiceCalendarEntryInput): Promise<Result<void, DomainRuleViolation | AuthorizationError>> {
    const entry = await this.repository.findEntryById(input.entryId);
    if (entry === null) return err(serviceCalendarEntryNotFoundError());

    const today = this.clock.now().toISOString().slice(0, 10);
    if (entry.calendarDate < today) {
      return err(new DomainRuleViolation({ code: 'CANNOT_EDIT_PAST', message: "You can't remove a closure that's already happened." }));
    }

    const outcome = await this.repository.deleteEntry(input.entryId);
    if (outcome === 'not_found') return err(serviceCalendarEntryNotFoundError());

    await this.auditRecorder.recordChange({
      entityType: 'config.service_calendar',
      entityId: input.entryId,
      action: 'deleted',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(undefined);
  }
}
