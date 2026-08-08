import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation } from '../../../kernel/errors/domain-error.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';

import type { ClinicSessionRepository } from './clinic-session-repository.js';
import { clinicSessionNotFoundForLifecycleError } from './start-session.handler.js';

export interface CompleteSessionCommandInput {
  readonly sessionId: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface CompleteSessionResult {
  readonly sessionId: string;
  readonly status: 'completed';
  readonly actuallyEndedAt: Date | null;
  readonly expiredAppointments: number;
  readonly version: number;
}

/**
 * `POST /api/v1/sessions/{id}/complete` (API §3.3, FR-APT-25). Any
 * booking still `booked` transitions to `expired`, never `no_show` — the
 * patient was never called (BR-22/EC-13) — with no penalty and an
 * apology notice, not a silent status change.
 */
export class CompleteSessionHandler {
  constructor(
    private readonly repository: ClinicSessionRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
  ) {}

  async execute(input: CompleteSessionCommandInput): Promise<Result<CompleteSessionResult, ConflictError | DomainRuleViolation | AuthorizationError>> {
    const outcome = await this.repository.completeSession(input.sessionId, input.expectedVersion, this.clock.now());

    if (outcome.outcome === 'not_found') return err(clinicSessionNotFoundForLifecycleError());
    if (outcome.outcome === 'invalid_transition') {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'This session hasn’t been started.' }));
    }
    if (outcome.outcome === 'consultation_in_progress') {
      return err(new DomainRuleViolation({ code: 'CONSULTATION_IN_PROGRESS', message: 'One patient is still in consultation. Complete that first.' }));
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

    for (const appointment of outcome.expiredAppointments) {
      if (appointment.studentId === null) continue;
      await this.enqueueNotification({
        recipientId: appointment.studentId,
        templateKey: 'session_completed_expired',
        payload: { doctorName: outcome.session.doctorName, sessionDate: outcome.session.sessionDate, serialNumber: appointment.serialNumber },
        channel: 'in_app',
        correlationId: input.correlationId,
      });
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.clinic_session',
      entityId: input.sessionId,
      action: 'completed',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok({
      sessionId: outcome.session.sessionId,
      status: 'completed',
      actuallyEndedAt: outcome.session.actuallyEndedAt,
      expiredAppointments: outcome.expiredAppointments.length,
      version: outcome.session.version,
    });
  }
}
