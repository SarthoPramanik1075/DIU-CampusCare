import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { AuthorizationError, ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isValidEffectiveRange, isValidLocalTimeOrder, isValidWeekday } from '../domain/validation.js';

import type { DutyRoster, DutyRosterRepository } from './duty-roster-repository.js';

export interface UpdateDutyRosterCommandInput {
  readonly rosterId: string;
  readonly weekday: number | undefined;
  readonly startsAtLocal: string | undefined;
  readonly endsAtLocal: string | undefined;
  readonly effectiveFrom: string | undefined;
  readonly effectiveTo: string | null | undefined;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export function dutyRosterNotFoundError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That duty roster entry could not be found.', httpStatus: 404 });
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * `PATCH /api/v1/duty-rosters/{id}` (API §3.2). Editing a roster never
 * retroactively touches sessions already materialised from it — a
 * roster is a template, and rewriting history from a template edit
 * would silently move appointments.
 */
export class UpdateDutyRosterHandler {
  constructor(
    private readonly repository: DutyRosterRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: UpdateDutyRosterCommandInput): Promise<Result<DutyRoster, ValidationError | ConflictError | DomainRuleViolation | AuthorizationError>> {
    if (input.weekday !== undefined && !isValidWeekday(input.weekday)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Choose a day of the week.',
          fields: [{ field: 'weekday', rule: 'FR-SCH-02', message: 'Integer 0–6' }],
        }),
      );
    }
    if (input.startsAtLocal !== undefined && input.endsAtLocal !== undefined && !isValidLocalTimeOrder(input.startsAtLocal, input.endsAtLocal)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'End time must be after the start time.',
          fields: [{ field: 'endsAtLocal', rule: 'VR-10', message: 'Must be strictly after startsAtLocal' }],
        }),
      );
    }
    if (input.effectiveFrom !== undefined && input.effectiveTo !== undefined && !isValidEffectiveRange(input.effectiveFrom, input.effectiveTo)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'The effective-to date must be on or after the effective-from date.',
          fields: [{ field: 'effectiveTo', rule: 'API §3.2', message: 'Must be on/after effectiveFrom' }],
        }),
      );
    }

    const outcome = await this.repository.updateDutyRoster({
      rosterId: input.rosterId,
      weekday: input.weekday,
      startsAtLocal: input.startsAtLocal,
      endsAtLocal: input.endsAtLocal,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      expectedVersion: input.expectedVersion,
    });

    if (outcome.outcome === 'not_found') return err(dutyRosterNotFoundError());
    if (outcome.outcome === 'overlap') {
      const dayName = WEEKDAY_NAMES[outcome.conflictingRoster.weekday];
      return err(
        new DomainRuleViolation({
          code: 'ROSTER_OVERLAP',
          message: `This doctor already has duty on ${dayName} from ${outcome.conflictingRoster.startsAtLocal} to ${outcome.conflictingRoster.endsAtLocal}. Change that entry instead.`,
          details: { conflictingRoster: outcome.conflictingRoster },
        }),
      );
    }
    if (outcome.outcome === 'stale') {
      const current = await this.repository.findDutyRosterById(input.rosterId);
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else updated this a moment ago. Here is the current version — review it and try again.',
          ...(current === null ? {} : { details: { current } }),
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.duty_roster',
      entityId: input.rosterId,
      action: 'updated',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.roster);
  }
}
