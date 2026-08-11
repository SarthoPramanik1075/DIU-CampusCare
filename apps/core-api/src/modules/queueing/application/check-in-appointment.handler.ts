import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { permittedTransitions, type AppointmentStatus } from '../domain/appointment-status.js';
import { orderQueue } from '../domain/queue-ordering.js';

import type { AppointmentDetail, AppointmentRepository } from './appointment-repository.js';
import { appointmentNotFoundError } from './cancel-appointment.handler.js';

export interface CheckInAppointmentCommandInput {
  readonly appointmentId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string | null;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface CheckInResult {
  readonly appointment: AppointmentDetail;
  readonly position: number | null;
  readonly permittedTransitions: readonly AppointmentStatus[];
  readonly replay: boolean;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function staleError(current: AppointmentDetail): ConflictError {
  return new ConflictError({
    code: 'CONFLICT_STALE_VERSION',
    message: "Someone else just updated this patient. Here's the current state.",
    details: { current: { appointmentId: current.appointmentId, status: current.status, version: current.version } },
  });
}

function nextSteps(status: AppointmentStatus): readonly AppointmentStatus[] {
  const advanceTo = permittedTransitions(status).advanceTo;
  return advanceTo === null ? [] : [advanceTo];
}

/**
 * `POST /api/v1/appointments/{id}/check-in` (API §4.3, VR-27, M3-T07). VR-27's
 * "on the current date" and "session must not have ended" halves are checked
 * here against the freshly fetched detail — `repository.checkIn` only
 * re-enforces the pure `booked` check as its own narrower, race-safe guard
 * at the actual write.
 */
export class CheckInAppointmentHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: CheckInAppointmentCommandInput): Promise<Result<CheckInResult, AuthorizationError | DomainRuleViolation | ConflictError>> {
    const detail = await this.repository.findAppointmentDetail(input.appointmentId);
    if (detail === null) return err(appointmentNotFoundError());

    const now = this.clock.now();
    const isReplay = input.idempotencyKey !== null && detail.idempotencyKey === input.idempotencyKey;

    if (!isReplay) {
      if (detail.status !== 'booked') {
        return err(
          new DomainRuleViolation({
            code: 'INVALID_STATUS_TRANSITION',
            message: 'This patient is already checked in.',
            details: { permittedTransitions: nextSteps(detail.status) },
          }),
        );
      }
      if (detail.sessionStatus === 'completed' || detail.sessionStatus === 'cancelled') {
        return err(new DomainRuleViolation({ code: 'SESSION_ENDED', message: 'That session has ended. Register this patient as a walk-in instead.' }));
      }
      if (detail.sessionDate !== toIsoDate(now)) {
        return err(new DomainRuleViolation({ code: 'WRONG_DATE', message: `This appointment is for ${detail.sessionDate}, not today.` }));
      }
    }

    const outcome = await this.repository.checkIn(input.appointmentId, input.expectedVersion, now, input.idempotencyKey);

    if (outcome.outcome === 'not_found') return err(appointmentNotFoundError());
    if (outcome.outcome === 'invalid_transition') {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'This patient is already checked in.' }));
    }
    if (outcome.outcome === 'stale') return err(staleError(outcome.current));

    if (outcome.replay !== true) {
      await this.auditRecorder.recordChange({
        entityType: 'queueing.appointment',
        entityId: input.appointmentId,
        action: 'checked_in',
        beforeState: { status: detail.status },
        afterState: { status: outcome.appointment.status },
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
    }

    const entries = orderQueue(await this.repository.listActiveQueueEntries(outcome.appointment.clinicSessionId));
    const index = entries.findIndex((entry) => entry.appointmentId === outcome.appointment.appointmentId);

    return ok({
      appointment: outcome.appointment,
      position: index === -1 ? null : index + 1,
      permittedTransitions: nextSteps(outcome.appointment.status),
      replay: outcome.replay === true,
    });
  }
}
