import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { computeMeanConsultationDurationMinutes, estimateForPosition, filterAnomalousDurations, shouldNotifySlip } from '../domain/estimation.js';
import { orderQueue } from '../domain/queue-ordering.js';

import type { AppointmentRepository } from './appointment-repository.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * FR-APT-21's recalculation (M3-T15) — run synchronously, right after the
 * triggering write commits, by each of `CancelAppointmentHandler`,
 * `MarkNoShowHandler`, `MarkEmergencyHandler`, `AdvanceAppointmentHandler`
 * (on `-> completed`) and, once M3-I exists, walk-in registration. Not
 * queued or scheduled — the whole point is that every other patient in the
 * session sees an estimate reflecting the event that just happened.
 *
 * `notifySlips=false` exists for `MarkEmergencyHandler`: it already sends
 * its own `emergency_inserted` notice to every other active entry over the
 * *same* `last_slip_notified_at` throttle column (a deliberate M3-F reuse
 * of that column as a general "last time this patient was told their wait
 * changed" marker, not two independent concepts) — running this handler's
 * own `estimate_slipped` pass on top of that would double-notify the same
 * patients for the same event.
 */
export class RecalculateSessionEstimatesHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly policyStore: PolicyStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
  ) {}

  async execute(clinicSessionId: string, now: Date, trigger: string, actorId: string | null, correlationId: string, notifySlips = true): Promise<void> {
    const context = await this.repository.findSessionQueueContext(clinicSessionId);
    if (context === null) return;

    const anomalyMultiplier = await this.policyStore.getRequiredInteger('queueing.estimation.anomalyMultiplier');
    const slipThresholdMinutes = await this.policyStore.getRequiredInteger('queueing.booking.estimateSlipNotifyThresholdMinutes');

    const sessionDurations = filterAnomalousDurations(
      await this.repository.listCompletedConsultationDurationsForSession(clinicSessionId),
      context.slotLengthMinutes,
      anomalyMultiplier,
    ).included;

    const doctorDurations = filterAnomalousDurations(
      await this.repository.listDoctorTrailingConsultationDurations(context.doctorId, new Date(now.getTime() - THIRTY_DAYS_MS)),
      context.slotLengthMinutes,
      anomalyMultiplier,
    ).included;
    const doctorTrailingMean = doctorDurations.length > 0 ? average(doctorDurations) : null;

    const meanDuration = computeMeanConsultationDurationMinutes(sessionDurations, doctorTrailingMean, context.slotLengthMinutes);

    const ordered = orderQueue(await this.repository.listRecalculationTargets(clinicSessionId));

    let updatedCount = 0;
    let slipNotifications = 0;

    for (const [index, entry] of ordered.entries()) {
      // The patient currently being seen isn't re-estimated — they have no "wait" left to predict.
      if (entry.status === 'in_consultation') continue;

      const currentEstimate = estimateForPosition(now, index, meanDuration);

      let notify = false;
      if (notifySlips && entry.studentId !== null && entry.estimateAtBooking !== null && shouldNotifySlip(entry.estimateAtBooking, currentEstimate, entry.lastSlipNotifiedAt, slipThresholdMinutes)) {
        notify = true;
        slipNotifications += 1;
        await this.enqueueNotification({
          recipientId: entry.studentId,
          templateKey: 'estimate_slipped',
          payload: { currentEstimate: currentEstimate.toISOString() },
          channel: 'in_app',
          correlationId,
        });
      }

      await this.repository.updateCurrentEstimate(entry.appointmentId, currentEstimate, notify, now);
      updatedCount += 1;
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.clinic_session',
      entityId: clinicSessionId,
      action: 'estimates_recalculated',
      afterState: { trigger, appointmentsUpdated: updatedCount, slipNotificationsSent: slipNotifications },
      actorId,
      correlationId,
    });
  }
}
