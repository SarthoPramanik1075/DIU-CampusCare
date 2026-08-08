import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { AuthorizationError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isValidEffectiveRange, isValidLocalTimeOrder, isValidWeekday } from '../domain/validation.js';

import type { DutyRoster, DutyRosterRepository } from './duty-roster-repository.js';

export interface CreateDutyRosterCommandInput {
  readonly doctorId: string;
  readonly weekday: number;
  readonly startsAtLocal: string;
  readonly endsAtLocal: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly actorId: string;
  readonly correlationId: string;
}

export function doctorNotFoundForRosterError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That doctor could not be found.', httpStatus: 404 });
}

/** Display text only (not a business rule DR-4 applies to) — 0 = Sunday, the Postgres `DOW`/API convention this module uses throughout. */
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** `POST /api/v1/doctors/{id}/duty-rosters` (API §3.2, FR-SCH-02). */
export class CreateDutyRosterHandler {
  constructor(
    private readonly repository: DutyRosterRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: CreateDutyRosterCommandInput): Promise<Result<DutyRoster, ValidationError | DomainRuleViolation | AuthorizationError>> {
    if (!isValidWeekday(input.weekday)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Choose a day of the week.',
          fields: [{ field: 'weekday', rule: 'FR-SCH-02', message: 'Integer 0–6' }],
        }),
      );
    }
    if (!isValidLocalTimeOrder(input.startsAtLocal, input.endsAtLocal)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'End time must be after the start time.',
          fields: [{ field: 'endsAtLocal', rule: 'VR-10', message: 'Must be strictly after startsAtLocal' }],
        }),
      );
    }
    if (!isValidEffectiveRange(input.effectiveFrom, input.effectiveTo)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'The effective-to date must be on or after the effective-from date.',
          fields: [{ field: 'effectiveTo', rule: 'API §3.2', message: 'Must be on/after effectiveFrom' }],
        }),
      );
    }

    if (!(await this.repository.doctorExists(input.doctorId))) return err(doctorNotFoundForRosterError());

    const result = await this.repository.createDutyRoster({
      doctorId: input.doctorId,
      weekday: input.weekday,
      startsAtLocal: input.startsAtLocal,
      endsAtLocal: input.endsAtLocal,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      createdBy: input.actorId,
    });

    if (result.outcome === 'overlap') {
      const dayName = WEEKDAY_NAMES[result.conflictingRoster.weekday];
      return err(
        new DomainRuleViolation({
          code: 'ROSTER_OVERLAP',
          message: `This doctor already has duty on ${dayName} from ${result.conflictingRoster.startsAtLocal} to ${result.conflictingRoster.endsAtLocal}. Change that entry instead.`,
          details: { conflictingRoster: result.conflictingRoster },
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.duty_roster',
      entityId: result.roster.rosterId,
      action: 'created',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(result.roster);
  }
}
