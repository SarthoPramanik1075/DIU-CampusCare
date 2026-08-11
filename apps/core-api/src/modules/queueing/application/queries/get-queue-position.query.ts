import type { Clock } from '../../../../kernel/clock/clock.js';
import { DomainRuleViolation } from '../../../../kernel/errors/domain-error.js';
import type { PolicyStore } from '../../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import { orderQueue } from '../../domain/queue-ordering.js';
import { ACTIVE_BOOKING_STATUSES, type AppointmentRepository } from '../appointment-repository.js';

export interface QueuePositionResult {
  readonly serialNumber: number;
  readonly patientsAhead: number;
  readonly nowServingSerial: number | null;
  readonly currentEstimate: Date | null;
  readonly sessionStatus: string;
  readonly asOf: Date;
  readonly pollAfterSeconds: number;
}

function notInQueueError(): DomainRuleViolation {
  return new DomainRuleViolation({ code: 'NOT_IN_QUEUE', message: "This appointment isn't in the live queue right now." });
}

/**
 * `GET /api/v1/appointments/{id}/queue-position` (API §4.1, S-07).
 * `patientsAhead` and `nowServingSerial` are both derived from the same
 * `orderQueue` pass over the session's active entries — the exact
 * ordering F-01's console renders, so a student's position and what
 * staff see can never silently disagree.
 */
export class GetQueuePositionQuery {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly policyStore: PolicyStore,
    private readonly clock: Clock,
  ) {}

  async execute(appointmentId: string, studentId: string): Promise<Result<QueuePositionResult, DomainRuleViolation>> {
    const detail = await this.repository.findAppointmentDetail(appointmentId);
    if (detail?.studentId !== studentId) return err(notInQueueError());
    if (!(ACTIVE_BOOKING_STATUSES as readonly string[]).includes(detail.status)) return err(notInQueueError());

    const entries = orderQueue(await this.repository.listActiveQueueEntries(detail.clinicSessionId));
    const myIndex = entries.findIndex((entry) => entry.appointmentId === appointmentId);
    const nowServing = entries.find((entry) => entry.status === 'in_consultation');
    const pollAfterSeconds = await this.policyStore.getRequiredInteger('queueing.queuePosition.pollIntervalSeconds');

    return ok({
      serialNumber: detail.serialNumber,
      patientsAhead: myIndex === -1 ? 0 : myIndex,
      nowServingSerial: nowServing?.serialNumber ?? null,
      currentEstimate: detail.currentEstimate,
      sessionStatus: detail.sessionStatus,
      asOf: this.clock.now(),
      pollAfterSeconds,
    });
  }
}
