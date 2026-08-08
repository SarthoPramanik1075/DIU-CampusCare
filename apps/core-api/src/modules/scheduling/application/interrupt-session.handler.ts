import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { AuthorizationError, ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isValidReason } from '../domain/validation.js';

import type { ClinicSessionRepository } from './clinic-session-repository.js';
import { clinicSessionNotFoundForLifecycleError } from './start-session.handler.js';

export interface InterruptSessionCommandInput {
  readonly sessionId: string;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface InterruptSessionResult {
  readonly sessionId: string;
  readonly status: 'interrupted';
  readonly remainingPatients: number;
  readonly notificationsQueued: number;
  readonly version: number;
}

/**
 * `POST /api/v1/sessions/{id}/interrupt` (API §3.3, EC-04). Bookings are
 * never auto-cancelled — resuming is `start`, cancelling is `cancel`; an
 * automatic cancellation here would take that decision away from the
 * people holding the room.
 */
export class InterruptSessionHandler {
  constructor(
    private readonly repository: ClinicSessionRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
  ) {}

  async execute(input: InterruptSessionCommandInput): Promise<Result<InterruptSessionResult, ValidationError | ConflictError | DomainRuleViolation | AuthorizationError>> {
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Required' }],
        }),
      );
    }

    const outcome = await this.repository.interruptSession(input.sessionId, input.expectedVersion, input.reason);

    if (outcome.outcome === 'not_found') return err(clinicSessionNotFoundForLifecycleError());
    if (outcome.outcome === 'invalid_transition') {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'Only a session that’s running can be marked interrupted.' }));
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

    const notifiable = outcome.remainingAppointments.filter((appointment): appointment is typeof appointment & { studentId: string } => appointment.studentId !== null);
    for (const appointment of notifiable) {
      await this.enqueueNotification({
        recipientId: appointment.studentId,
        templateKey: 'session_interrupted',
        payload: { doctorName: outcome.session.doctorName, sessionDate: outcome.session.sessionDate, reason: input.reason, serialNumber: appointment.serialNumber },
        channel: 'in_app',
        correlationId: input.correlationId,
      });
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.clinic_session',
      entityId: input.sessionId,
      action: 'interrupted',
      afterState: { reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok({
      sessionId: outcome.session.sessionId,
      status: 'interrupted',
      remainingPatients: outcome.remainingAppointments.length,
      notificationsQueued: notifiable.length,
      version: outcome.session.version,
    });
  }
}
