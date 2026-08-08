import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { deriveSlots } from '../domain/slot-derivation.js';
import {
  isAtLeastOneSlot,
  isNotInThePast,
  isValidReason,
  isValidSlotLength,
  isValidTimeOrder,
  isValidWalkInAllocation,
  requiresChangeReason,
} from '../domain/validation.js';

import type { ClinicSessionListItem, ClinicSessionRepository } from './clinic-session-repository.js';

export interface CreateClinicSessionCommandInput {
  readonly doctorId: string;
  readonly dutyRosterId: string | null;
  readonly sessionDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly slotLengthMinutes: number | undefined;
  readonly walkInAllocationPct: number | undefined;
  readonly changeReason: string | null;
  readonly overrideNonServiceDay: boolean;
  readonly actorId: string;
  readonly correlationId: string;
}

export function doctorNotFoundForSessionError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That doctor could not be found.', httpStatus: 404 });
}

/**
 * `POST /api/v1/sessions` (API §3.3, FR-SCH-03/04/05/13/14/16). Creates
 * either a roster-materialised session (`dutyRosterId` given) or a
 * date-specific override (`dutyRosterId: null`) — this handler treats
 * both identically; the distinction is only in what the caller passes.
 */
export class CreateClinicSessionHandler {
  constructor(
    private readonly repository: ClinicSessionRepository,
    private readonly policyStore: PolicyStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateClinicSessionCommandInput): Promise<Result<ClinicSessionListItem, ValidationError | DomainRuleViolation | AuthorizationError>> {
    if (!isValidTimeOrder(input.startsAt, input.endsAt)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'End time must be after the start time.',
          fields: [{ field: 'endsAt', rule: 'VR-10', message: 'Must be strictly after startsAt' }],
        }),
      );
    }
    if (!isNotInThePast(input.sessionDate, toIsoDate(this.clock.now()))) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Choose a date from today onwards.',
          fields: [{ field: 'sessionDate', rule: 'VR-15', message: 'Must not be in the past' }],
        }),
      );
    }

    const slotLengthMinutes = input.slotLengthMinutes ?? (await this.policyStore.getRequiredInteger('scheduling.session.defaultSlotLengthMinutes'));
    if (!isValidSlotLength(slotLengthMinutes)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Slot length must be an integer between 5 and 60 minutes.',
          fields: [{ field: 'slotLengthMinutes', rule: 'VR-12', message: 'Integer 5–60' }],
        }),
      );
    }
    if (!isAtLeastOneSlot(input.startsAt, input.endsAt, slotLengthMinutes)) {
      return err(
        new ValidationError({
          code: 'SESSION_TOO_SHORT',
          message: `A session needs to be at least as long as one slot (${String(slotLengthMinutes)} minutes).`,
        }),
      );
    }

    const walkInAllocationPct = input.walkInAllocationPct ?? (await this.policyStore.getRequiredInteger('scheduling.session.defaultWalkInAllocationPct'));
    if (!isValidWalkInAllocation(walkInAllocationPct)) {
      return err(
        new ValidationError({
          code: 'WALK_IN_ALLOCATION_INVALID',
          message: 'A 100% walk-in allocation would leave no slots available to book online. Choose 0–99.',
        }),
      );
    }

    const locationId = await this.repository.findDoctorLocationId(input.doctorId);
    if (locationId === null) return err(doctorNotFoundForSessionError());

    const closure = await this.repository.findServiceCalendarClosure(locationId, input.sessionDate);
    if (closure !== null && !input.overrideNonServiceDay) {
      return err(
        new DomainRuleViolation({
          code: 'NON_SERVICE_DAY',
          message: `${formatDisplayDate(input.sessionDate)} is marked as a non-service day: ${closure.reason}. Remove that entry or confirm the override.`,
          details: { calendarEntry: closure },
        }),
      );
    }

    if (requiresChangeReason(input.startsAt, this.clock.now()) && !isValidReason(input.changeReason ?? '')) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Sessions starting within 24 hours need a reason of at least 10 characters.',
          fields: [{ field: 'changeReason', rule: 'VR-18', message: 'Required within 24 hours of the session start' }],
        }),
      );
    }

    const { totalSlotCount, bookableSlotCount, slots } = deriveSlots({
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      slotLengthMinutes,
      walkInAllocationPct,
    });

    const result = await this.repository.createClinicSession({
      doctorId: input.doctorId,
      locationId,
      dutyRosterId: input.dutyRosterId,
      sessionDate: input.sessionDate,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      slotLengthMinutes,
      walkInAllocationPct,
      changeReason: input.changeReason,
      totalSlotCount,
      bookableSlotCount,
      slots,
      createdBy: input.actorId,
    });

    if (result.outcome === 'overlap') {
      return err(
        new DomainRuleViolation({
          code: 'SESSION_OVERLAP',
          message: `${result.conflictingSession.doctorName} already has a session from ${formatDisplayTime(result.conflictingSession.startsAt)} to ${formatDisplayTime(result.conflictingSession.endsAt)} that day.`,
          details: { conflictingSession: result.conflictingSession },
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.clinic_session',
      entityId: result.session.sessionId,
      action: 'created',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(result.session);
  }
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function formatDisplayTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dhaka' });
}
