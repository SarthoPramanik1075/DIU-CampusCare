import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { canAdvanceTo, permittedTransitions, type AppointmentStatus } from '../domain/appointment-status.js';
import { isValidReason } from '../domain/booking-validation.js';

import type { AppointmentDetail, AppointmentRepository } from './appointment-repository.js';
import { appointmentNotFoundError } from './cancel-appointment.handler.js';
import type { RecalculateSessionEstimatesHandler } from './recalculate-session-estimates.handler.js';
import type { RecordConsultationMetricsHandler } from './record-consultation-metrics.handler.js';

export interface AdvanceAppointmentCommandInput {
  readonly appointmentId: string;
  readonly toStatus: AppointmentStatus;
  readonly paymentOverrideReason: string | null;
  readonly expectedVersion: number;
  readonly idempotencyKey: string | null;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface AdvanceResult {
  readonly appointment: AppointmentDetail;
  readonly paymentOverrideRecorded: boolean;
  readonly permittedTransitions: readonly AppointmentStatus[];
  readonly replay: boolean;
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
 * `POST /api/v1/appointments/{id}/advance` (API §4.3, VR-28, FR-PAY-05,
 * M3-T08). The payment gate and the "session must be running" check both
 * read fields already on the fetched `AppointmentDetail`
 * (`paymentStatus`/`sessionStatus`), so they live here rather than inside
 * `repository.advance` — that method stays a pure state-transition
 * primitive, same split as check-in's date/session checks.
 */
export class AdvanceAppointmentHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
    private readonly recalculate: RecalculateSessionEstimatesHandler,
    private readonly recordConsultationMetrics: RecordConsultationMetricsHandler,
  ) {}

  async execute(input: AdvanceAppointmentCommandInput): Promise<Result<AdvanceResult, AuthorizationError | DomainRuleViolation | ConflictError>> {
    const detail = await this.repository.findAppointmentDetail(input.appointmentId);
    if (detail === null) return err(appointmentNotFoundError());

    const isReplay = input.idempotencyKey !== null && detail.idempotencyKey === input.idempotencyKey;
    const requiresPaymentOverride = input.toStatus === 'in_consultation' && detail.paymentStatus === 'unpaid';

    if (!isReplay) {
      if (!canAdvanceTo(detail.status, input.toStatus)) {
        return err(
          new DomainRuleViolation({
            code: 'INVALID_STATUS_TRANSITION',
            message: 'This step is not next for this patient.',
            details: { permittedTransitions: nextSteps(detail.status) },
          }),
        );
      }
      if (detail.sessionStatus !== 'started' && detail.sessionStatus !== 'interrupted') {
        return err(new DomainRuleViolation({ code: 'SESSION_NOT_STARTED', message: 'Start the session before moving patients through the queue.' }));
      }
      if (requiresPaymentOverride && (input.paymentOverrideReason === null || !isValidReason(input.paymentOverrideReason))) {
        return err(
          new DomainRuleViolation({
            code: 'PAYMENT_REQUIRED',
            message: "This patient hasn't paid the consultation fee. Record the payment, or give a reason to continue anyway.",
          }),
        );
      }
    }

    const now = this.clock.now();
    const outcome = await this.repository.advance(input.appointmentId, input.toStatus, input.expectedVersion, now, input.idempotencyKey);

    if (outcome.outcome === 'not_found') return err(appointmentNotFoundError());
    if (outcome.outcome === 'invalid_transition') {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'This step is not next for this patient.' }));
    }
    if (outcome.outcome === 'stale') return err(staleError(outcome.current));

    const paymentOverrideRecorded = !isReplay && requiresPaymentOverride && input.paymentOverrideReason !== null;

    if (outcome.replay !== true) {
      await this.auditRecorder.recordChange({
        entityType: 'queueing.appointment',
        entityId: input.appointmentId,
        action: 'advanced',
        beforeState: { status: detail.status },
        afterState: { status: outcome.appointment.status, ...(paymentOverrideRecorded ? { paymentOverrideReason: input.paymentOverrideReason } : {}) },
        actorId: input.actorId,
        correlationId: input.correlationId,
      });

      if (input.toStatus === 'in_consultation') {
        // FR-APT-25/NFR-ACC-01: predicted = what the patient was told just before this transition.
        const predictedAt = detail.currentEstimate ?? detail.estimateAtBooking;
        if (predictedAt !== null) {
          await this.recordConsultationMetrics.execute({
            appointmentId: input.appointmentId,
            doctorId: detail.doctorId,
            predictedAt,
            actualStartedAt: now,
            actorId: input.actorId,
            correlationId: input.correlationId,
          });
        }
      } else if (input.toStatus === 'completed') {
        // FR-APT-21's "a consultation completes" trigger.
        await this.recalculate.execute(detail.clinicSessionId, now, 'consultation_completed', input.actorId, input.correlationId);
      }
    }

    return ok({
      appointment: outcome.appointment,
      paymentOverrideRecorded,
      permittedTransitions: nextSteps(outcome.appointment.status),
      replay: outcome.replay === true,
    });
  }
}
