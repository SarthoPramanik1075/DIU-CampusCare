import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';

import type { AppointmentRepository } from './appointment-repository.js';

export interface RecordConsultationMetricsInput {
  readonly appointmentId: string;
  readonly doctorId: string;
  readonly predictedAt: Date;
  readonly actualStartedAt: Date;
  readonly actorId: string;
  readonly correlationId: string;
}

/**
 * FR-APT-25 / NFR-ACC-01 / M3-T21 — one `queueing.estimate_accuracy_sample`
 * row per consultation that actually starts, comparing what the patient
 * was told (`current_estimate`, as it stood immediately before this
 * transition) against when it really started (`now`, the same instant
 * `AdvanceAppointmentHandler` writes as `consultation_started_at`).
 *
 * Fired on `checked_in/waiting -> in_consultation`, not `-> completed`:
 * both values being compared are already fixed the moment a consultation
 * starts, and FR-APT-25 names "actual consultation start" as the thing
 * being recorded — waiting until completion would only delay the write,
 * not change what it measures.
 */
export class RecordConsultationMetricsHandler {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: RecordConsultationMetricsInput): Promise<void> {
    const deviationMinutes = Math.round((input.actualStartedAt.getTime() - input.predictedAt.getTime()) / 60_000);

    await this.repository.recordEstimateAccuracySample({
      appointmentId: input.appointmentId,
      doctorId: input.doctorId,
      predictedAt: input.predictedAt,
      actualStartedAt: input.actualStartedAt,
      deviationMinutes,
    });

    await this.auditRecorder.recordChange({
      entityType: 'queueing.estimate_accuracy_sample',
      entityId: input.appointmentId,
      action: 'recorded',
      afterState: { deviationMinutes },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });
  }
}
