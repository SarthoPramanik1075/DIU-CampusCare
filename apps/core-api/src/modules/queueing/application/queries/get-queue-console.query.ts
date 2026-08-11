import type { AuditRecorder } from '../../../../kernel/audit/audit-recorder.js';
import type { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { ClinicSessionListItem, ListClinicSessionsQuery } from '../../../scheduling/index.js';
import { permittedTransitions, type PermittedTransitions } from '../../domain/appointment-status.js';
import { orderQueue } from '../../domain/queue-ordering.js';
import type { AppointmentRepository, QueueConsoleRow } from '../appointment-repository.js';

export interface QueueCounts {
  readonly waiting: number;
  readonly checkedIn: number;
  readonly inConsultation: number;
  readonly completed: number;
  readonly noShow: number;
  readonly cancelled: number;
}

export interface QueueConsoleRowWithActions extends QueueConsoleRow {
  readonly permittedTransitions: PermittedTransitions;
}

export interface QueueConsoleSession {
  readonly sessionId: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly sessionStatus: ClinicSessionListItem['status'];
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly nowServingSerial: number | null;
  readonly walkInAllocationExceeded: boolean;
  readonly counts: QueueCounts;
  readonly queue: readonly QueueConsoleRowWithActions[];
}

export function computeCounts(rows: readonly QueueConsoleRow[]): QueueCounts {
  const count = (status: QueueConsoleRow['status']) => rows.filter((row) => row.status === status).length;
  return {
    waiting: count('waiting'),
    checkedIn: count('checked_in'),
    inConsultation: count('in_consultation'),
    completed: count('completed'),
    noShow: count('no_show'),
    cancelled: count('cancelled') + count('late_cancellation'),
  };
}

/**
 * `GET /api/v1/queue/console` (API §4.2, F-01, M3-T06/T17). "Every session
 * for the date across all doctors, one screen" (FR-APT-26) — composed from
 * scheduling's own session list plus this module's own queue rows per
 * session, the same cross-module read `GetAvailabilityQuery` already
 * established. Writes `audit.data_access_log` once per distinct student
 * whose identity this response carries (FR-AUD-03), mirroring
 * `preview-unavailability.handler.ts`'s exact pattern.
 */
export class GetQueueConsoleQuery {
  constructor(
    private readonly listClinicSessions: ListClinicSessionsQuery,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(date: string, doctorId: string | undefined, actorId: string, correlationId: string): Promise<Result<readonly QueueConsoleSession[], ValidationError>> {
    const sessionsResult = await this.listClinicSessions.execute({ from: date, to: date, ...(doctorId === undefined ? {} : { doctorId }) });
    if (!sessionsResult.ok) return err(sessionsResult.error);

    const distinctStudentIds = new Set<string>();

    const sessions = await Promise.all(
      sessionsResult.value.map(async (session): Promise<QueueConsoleSession> => {
        const rows = await this.appointmentRepository.listConsoleRows(session.sessionId);
        for (const row of rows) {
          if (row.studentId !== null) distinctStudentIds.add(row.studentId);
        }

        const ordered = orderQueue(rows);
        const nowServing = ordered.find((row) => row.status === 'in_consultation');

        return {
          sessionId: session.sessionId,
          doctorId: session.doctorId,
          doctorName: session.doctorName,
          sessionStatus: session.status,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          nowServingSerial: nowServing?.serialNumber ?? null,
          walkInAllocationExceeded: rows.some((row) => row.exceededWalkinAllocation),
          counts: computeCounts(rows),
          queue: ordered.map((row) => ({ ...row, permittedTransitions: permittedTransitions(row.status) })),
        };
      }),
    );

    for (const studentId of distinctStudentIds) {
      await this.auditRecorder.recordDataAccess({ accessorId: actorId, subjectId: studentId, dataCategory: 'queueing.appointment', correlationId });
    }

    return ok(sessions);
  }
}
