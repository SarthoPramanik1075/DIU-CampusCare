import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { canEditTimes } from '../domain/clinic-session.js';
import { deriveSlots } from '../domain/slot-derivation.js';
import { isAtLeastOneSlot, isValidReason, isValidSlotLength, isValidTimeOrder, isValidWalkInAllocation, requiresChangeReason } from '../domain/validation.js';

import type { ClinicSessionListItem, ClinicSessionRepository } from './clinic-session-repository.js';

export interface UpdateClinicSessionCommandInput {
  readonly sessionId: string;
  readonly startsAt: Date | undefined;
  readonly endsAt: Date | undefined;
  readonly slotLengthMinutes: number | undefined;
  readonly walkInAllocationPct: number | undefined;
  readonly changeReason: string | null | undefined;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export function clinicSessionNotFoundError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That session could not be found.', httpStatus: 404 });
}

/**
 * `PATCH /api/v1/sessions/{id}` (API §3.3). Only `scheduled` sessions may
 * have their timing/capacity edited (`canEditTimes` — API's own
 * `SESSION_ALREADY_STARTED`); a started/interrupted/completed/cancelled
 * session's history is not rewritable.
 */
export class UpdateClinicSessionHandler {
  constructor(
    private readonly repository: ClinicSessionRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: UpdateClinicSessionCommandInput): Promise<Result<ClinicSessionListItem, ValidationError | ConflictError | DomainRuleViolation | AuthorizationError>> {
    const current = await this.repository.findClinicSessionById(input.sessionId);
    if (current === null) return err(clinicSessionNotFoundError());

    const isRetiming = input.startsAt !== undefined || input.endsAt !== undefined || input.slotLengthMinutes !== undefined || input.walkInAllocationPct !== undefined;

    if (isRetiming && !canEditTimes(current.status)) {
      return err(
        new DomainRuleViolation({
          code: 'SESSION_ALREADY_STARTED',
          message: 'This session has already started, so its timing and capacity can no longer be changed.',
        }),
      );
    }

    const startsAt = input.startsAt ?? current.startsAt;
    const endsAt = input.endsAt ?? current.endsAt;
    const slotLengthMinutes = input.slotLengthMinutes ?? current.slotLengthMinutes;
    const walkInAllocationPct = input.walkInAllocationPct ?? current.walkInAllocationPct;

    if (!isValidTimeOrder(startsAt, endsAt)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'End time must be after the start time.',
          fields: [{ field: 'endsAt', rule: 'VR-10', message: 'Must be strictly after startsAt' }],
        }),
      );
    }
    if (!isValidSlotLength(slotLengthMinutes)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Slot length must be an integer between 5 and 60 minutes.',
          fields: [{ field: 'slotLengthMinutes', rule: 'VR-12', message: 'Integer 5–60' }],
        }),
      );
    }
    if (!isAtLeastOneSlot(startsAt, endsAt, slotLengthMinutes)) {
      return err(
        new ValidationError({
          code: 'SESSION_TOO_SHORT',
          message: `A session needs to be at least as long as one slot (${String(slotLengthMinutes)} minutes).`,
        }),
      );
    }
    if (!isValidWalkInAllocation(walkInAllocationPct)) {
      return err(
        new ValidationError({
          code: 'WALK_IN_ALLOCATION_INVALID',
          message: 'A 100% walk-in allocation would leave no slots available to book online. Choose 0–99.',
        }),
      );
    }

    if (requiresChangeReason(startsAt, this.clock.now()) && !isValidReason(input.changeReason ?? '')) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Changes taking effect within 24 hours need a reason of at least 10 characters.',
          fields: [{ field: 'changeReason', rule: 'VR-18', message: 'Required within 24 hours of the session start' }],
        }),
      );
    }

    let totalSlotCount: number | undefined;
    let bookableSlotCount: number | undefined;
    let slots: ReturnType<typeof deriveSlots>['slots'] | undefined;

    if (isRetiming) {
      const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes, walkInAllocationPct });
      if (derived.bookableSlotCount < current.bookedSlotCount) {
        return err(
          new DomainRuleViolation({
            code: 'CAPACITY_BELOW_BOOKINGS',
            message: `This change would reduce bookable slots to ${String(derived.bookableSlotCount)}, below the ${String(current.bookedSlotCount)} already booked. Choose settings that keep capacity at or above the current bookings.`,
            details: { bookedCount: current.bookedSlotCount, requestedBookableSlotCount: derived.bookableSlotCount },
          }),
        );
      }
      totalSlotCount = derived.totalSlotCount;
      bookableSlotCount = derived.bookableSlotCount;
      slots = derived.slots;
    }

    const outcome = await this.repository.updateClinicSession({
      sessionId: input.sessionId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      slotLengthMinutes: input.slotLengthMinutes,
      walkInAllocationPct: input.walkInAllocationPct,
      changeReason: input.changeReason,
      totalSlotCount,
      bookableSlotCount,
      slots,
      expectedVersion: input.expectedVersion,
    });

    if (outcome.outcome === 'not_found') return err(clinicSessionNotFoundError());
    if (outcome.outcome === 'overlap') {
      return err(
        new DomainRuleViolation({
          code: 'SESSION_OVERLAP',
          message: `${outcome.conflictingSession.doctorName} already has a session from ${formatDisplayTime(outcome.conflictingSession.startsAt)} to ${formatDisplayTime(outcome.conflictingSession.endsAt)} that day.`,
          details: { conflictingSession: outcome.conflictingSession },
        }),
      );
    }
    if (outcome.outcome === 'stale') {
      const latest = await this.repository.findClinicSessionById(input.sessionId);
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else updated this a moment ago. Here is the current version — review it and try again.',
          ...(latest === null ? {} : { details: { current: latest } }),
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.clinic_session',
      entityId: input.sessionId,
      action: 'updated',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.session);
  }
}

function formatDisplayTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dhaka' });
}
