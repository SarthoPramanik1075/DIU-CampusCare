import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';

import type { AppointmentRepository } from './appointment-repository.js';

export interface ExpireUnstartedSessionBookingsResult {
  readonly sessionsSwept: number;
  readonly appointmentsExpired: number;
}

/**
 * FR-APT-33/BR-22/EC-13/M3-T22. No background worker exists anywhere in
 * this repo (core-api and counseling-api are both request-driven only) —
 * standing one up for this single sweep would be disproportionate, so this
 * runs lazily instead: `GetQueueConsoleQuery` calls it at the top of every
 * read, the same pragmatism this project already applied to the outbox and
 * to `PolicyStore.defineIfAbsent`. A session that was simply never started
 * has nothing else that would ever touch it — `CompleteSessionHandler`
 * (M2) already handles the "started, then completed with stragglers" case
 * for `booked` rows; this handler is only for a session whose own status
 * never left `scheduled` at all.
 */
export class ExpireUnstartedSessionBookingsHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
  ) {}

  async execute(correlationId: string): Promise<ExpireUnstartedSessionBookingsResult> {
    const expired = await this.repository.expireUnstartedSessionBookings(this.clock.now());
    if (expired.length === 0) return { sessionsSwept: 0, appointmentsExpired: 0 };

    for (const appointment of expired) {
      if (appointment.studentId !== null) {
        await this.enqueueNotification({
          recipientId: appointment.studentId,
          templateKey: 'session_expired_rebooking_offer',
          payload: { appointmentRef: appointment.appointmentRef, doctorName: appointment.doctorName, sessionDate: appointment.sessionDate },
          channel: 'in_app',
          correlationId,
        });
      }

      await this.auditRecorder.recordChange({
        entityType: 'queueing.appointment',
        entityId: appointment.appointmentId,
        action: 'expired_unstarted_session',
        afterState: { status: 'expired' },
        correlationId,
      });
    }

    return { sessionsSwept: new Set(expired.map((appointment) => appointment.clinicSessionId)).size, appointmentsExpired: expired.length };
  }
}
