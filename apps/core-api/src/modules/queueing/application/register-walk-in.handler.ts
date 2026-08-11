import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { DomainRuleViolation, ValidationError, type AuthorizationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { clinicSessionNotFoundError } from '../../scheduling/index.js';
import { isValidReason } from '../domain/booking-validation.js';
import { orderQueue } from '../domain/queue-ordering.js';

import type { AppointmentRepository, WalkInAppointment } from './appointment-repository.js';
import type { RecalculateSessionEstimatesHandler } from './recalculate-session-estimates.handler.js';

export interface RegisterWalkInCommandInput {
  readonly clinicSessionId: string;
  readonly studentRef: string | null;
  readonly unregisteredName: string | null;
  readonly visitReasonCategoryId: string | null;
  readonly isEmergency: boolean;
  readonly emergencyReason: string | null;
  readonly idempotencyKey: string | null;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface RegisterWalkInResult {
  readonly appointment: WalkInAppointment;
  readonly position: number;
  readonly suspensionIgnored: boolean;
  readonly replay: boolean;
}

function studentNotFoundError(): ValidationError {
  return new ValidationError({
    code: 'STUDENT_NOT_FOUND',
    message: "That student ID isn't recognised. Check it, or record the patient by name as an unregistered walk-in.",
    fields: [{ field: 'studentRef', rule: 'VR-29', message: 'Does not resolve to an existing student' }],
    details: { suggestion: 'record_as_unregistered' },
  });
}

function todayIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `POST /api/v1/walk-ins` (API §4.4, FR-APT-35…38/42, EC-09/10, M3-T12/T13).
 * Deliberately checks none of VR-21…24 (booking limit, duplicate-doctor-day,
 * booking cutoff, active suspension) — API.md is explicit that none of them
 * apply here: "a student at the counter is a patient, not a booking
 * request." `suspensionIgnored` only *reports* that an active suspension
 * existed and was correctly not consulted, the same discipline
 * `BookAppointmentHandler` applies in the opposite direction.
 */
export class RegisterWalkInHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
    private readonly recalculate: RecalculateSessionEstimatesHandler,
  ) {}

  async execute(input: RegisterWalkInCommandInput): Promise<Result<RegisterWalkInResult, ValidationError | AuthorizationError | DomainRuleViolation>> {
    if (input.isEmergency && (input.emergencyReason === null || !isValidReason(input.emergencyReason))) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Give a reason of at least 10 characters for the emergency.',
          fields: [{ field: 'emergencyReason', rule: 'VR-30', message: 'Required, at least 10 characters, when isEmergency is true' }],
        }),
      );
    }

    let studentId: string | null = null;
    if (input.studentRef !== null) {
      const student = await this.repository.findStudentByRef(input.studentRef);
      if (student === null) {
        if (input.unregisteredName === null) return err(studentNotFoundError());
      } else {
        studentId = student.studentId;
      }
    } else if (input.unregisteredName === null) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Give a student ID or the patient’s name.',
          fields: [{ field: 'studentRef', rule: 'VR-29', message: 'Required unless unregisteredName is given' }],
        }),
      );
    }

    const context = await this.repository.findSessionQueueContext(input.clinicSessionId);
    if (context === null) return err(clinicSessionNotFoundError());

    const now = this.clock.now();
    if (context.sessionStatus === 'completed' || context.sessionStatus === 'cancelled' || context.endsAt.getTime() <= now.getTime()) {
      return err(new DomainRuleViolation({ code: 'SESSION_ENDED', message: "That session has ended. Choose a session that's still running." }));
    }
    if (context.sessionDate !== todayIsoDate(now)) {
      return err(new DomainRuleViolation({ code: 'SESSION_NOT_TODAY', message: "You can only add a walk-in to today's sessions." }));
    }

    const suspensionIgnored = studentId !== null && (await this.repository.findActiveSuspension(studentId, now)) !== null;

    const outcome = await this.repository.createWalkIn(
      {
        clinicSessionId: input.clinicSessionId,
        studentId,
        unregisteredName: input.unregisteredName,
        visitReasonCategoryId: input.visitReasonCategoryId,
        isEmergency: input.isEmergency,
        emergencyReason: input.isEmergency ? input.emergencyReason : null,
        createdBy: input.actorId,
        idempotencyKey: input.idempotencyKey,
      },
      now,
    );

    if (outcome.outcome === 'already_active_in_session') {
      return err(new DomainRuleViolation({ code: 'ALREADY_ACTIVE_IN_SESSION', message: 'This patient already has an active entry in this session.' }));
    }

    if (outcome.replay !== true) {
      await this.auditRecorder.recordChange({
        entityType: 'queueing.appointment',
        entityId: outcome.appointment.appointmentId,
        action: 'walk_in_registered',
        afterState: { serialNumber: outcome.appointment.serialNumber, isEmergency: outcome.appointment.isEmergency },
        actorId: input.actorId,
        correlationId: input.correlationId,
      });

      // FR-APT-21's "a walk-in is inserted" trigger.
      await this.recalculate.execute(input.clinicSessionId, now, 'walk_in_inserted', input.actorId, input.correlationId);
    }

    const refreshed = await this.repository.findAppointmentDetail(outcome.appointment.appointmentId);
    const currentEstimate = refreshed?.currentEstimate ?? outcome.appointment.currentEstimate;

    const entries = orderQueue(await this.repository.listActiveQueueEntries(input.clinicSessionId));
    const index = entries.findIndex((entry) => entry.appointmentId === outcome.appointment.appointmentId);

    return ok({
      appointment: { ...outcome.appointment, currentEstimate },
      position: index === -1 ? entries.length : index + 1,
      suspensionIgnored,
      replay: outcome.replay === true,
    });
  }
}
