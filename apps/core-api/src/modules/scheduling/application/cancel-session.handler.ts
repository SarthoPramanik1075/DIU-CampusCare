import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { AuthorizationError, ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { canCancel } from '../domain/clinic-session.js';
import { isValidReason } from '../domain/validation.js';

import type { ClinicSessionRepository } from './clinic-session-repository.js';
import { clinicSessionNotFoundForLifecycleError } from './start-session.handler.js';

export interface CancelSessionCommandInput {
  readonly sessionId: string;
  readonly reason: string;
  readonly confirmedImpact: boolean;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface CancelSessionResult {
  readonly sessionId: string;
  readonly status: 'cancelled';
  readonly cancelledAppointments: number;
  readonly notificationsQueued: number;
  readonly version: number;
}

/**
 * `POST /api/v1/sessions/{id}/cancel` (API §3.3, BR-26/BR-27). Unlike the
 * doctor-unavailability flow (M2-F), this is not a separate preview
 * endpoint — the same call returns `CONFIRMATION_REQUIRED` with the
 * affected list until the caller echoes `confirmedImpact: true`, per
 * API §3.3's own documented shape for this one endpoint.
 */
export class CancelSessionHandler {
  constructor(
    private readonly repository: ClinicSessionRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
  ) {}

  async execute(input: CancelSessionCommandInput): Promise<Result<CancelSessionResult, ValidationError | ConflictError | DomainRuleViolation | AuthorizationError>> {
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Required' }],
        }),
      );
    }

    const session = await this.repository.findClinicSessionById(input.sessionId);
    if (session === null) return err(clinicSessionNotFoundForLifecycleError());
    if (!canCancel(session.status)) {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'This session has already ended.' }));
    }

    if (!input.confirmedImpact) {
      const affectedAppointments = await this.repository.listOpenAppointments(input.sessionId);
      return err(
        new DomainRuleViolation({
          code: 'CONFIRMATION_REQUIRED',
          message: `${String(affectedAppointments.length)} patients have booked this session. They'll be cancelled and notified. Confirm to continue.`,
          details: { affectedAppointments },
        }),
      );
    }

    const outcome = await this.repository.cancelSession(input.sessionId, input.expectedVersion, input.reason);

    if (outcome.outcome === 'not_found') return err(clinicSessionNotFoundForLifecycleError());
    if (outcome.outcome === 'invalid_transition') {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'This session has already ended.' }));
    }
    if (outcome.outcome === 'stale') {
      const current = await this.repository.findClinicSessionById(input.sessionId);
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else updated this a moment ago. Here is the current version — review it and try again.',
          ...(current === null ? {} : { details: { current } }),
        }),
      );
    }

    const notifiable = outcome.cancelledAppointments.filter((appointment): appointment is typeof appointment & { studentId: string } => appointment.studentId !== null);
    for (const appointment of notifiable) {
      await this.enqueueNotification({
        recipientId: appointment.studentId,
        templateKey: 'session_cancelled',
        payload: { doctorName: outcome.session.doctorName, sessionDate: outcome.session.sessionDate, reason: input.reason, serialNumber: appointment.serialNumber },
        channel: 'in_app',
        correlationId: input.correlationId,
      });
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.clinic_session',
      entityId: input.sessionId,
      action: 'cancelled',
      afterState: { reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok({
      sessionId: outcome.session.sessionId,
      status: 'cancelled',
      cancelledAppointments: outcome.cancelledAppointments.length,
      notificationsQueued: notifiable.length,
      version: outcome.session.version,
    });
  }
}
