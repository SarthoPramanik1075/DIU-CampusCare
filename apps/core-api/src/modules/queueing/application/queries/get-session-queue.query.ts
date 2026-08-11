import type { AuditRecorder } from '../../../../kernel/audit/audit-recorder.js';
import { permittedTransitions } from '../../domain/appointment-status.js';
import { orderQueue } from '../../domain/queue-ordering.js';
import type { AppointmentRepository } from '../appointment-repository.js';

import { computeCounts, type QueueConsoleRowWithActions, type QueueCounts } from './get-queue-console.query.js';

export type SessionQueueViewerRole = 'MCS' | 'DOC' | 'ADM';

export interface SessionQueueViewer {
  readonly role: SessionQueueViewerRole;
  readonly userId: string;
}

export interface SessionQueueResult {
  readonly sessionId: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly sessionStatus: string;
  readonly nowServingSerial: number | null;
  readonly walkInAllocationExceeded: boolean;
  readonly counts: QueueCounts;
  /** `null` for `ADM` — "counts only," per the matrix's own note on this grant. */
  readonly queue: readonly QueueConsoleRowWithActions[] | null;
}

/**
 * `GET /api/v1/sessions/{id}/queue` (API §4.2). `DOC` sees only their own
 * session — a cross-doctor request returns `null` (→ 404, not 403, PRM-07)
 * exactly like `GetAppointmentDetailQuery`'s own reasoning. `ADM` gets the
 * session shell and counts but no `queue[]` — "metadata only" carried one
 * level further than appointment detail's redaction, since the matrix's
 * own note for this grant says counts only, not per-row redaction.
 */
export class GetSessionQueueQuery {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(sessionId: string, viewer: SessionQueueViewer, correlationId: string): Promise<SessionQueueResult | null> {
    const context = await this.repository.findSessionQueueContext(sessionId);
    if (context === null) return null;
    if (viewer.role === 'DOC' && context.doctorUserAccountId !== viewer.userId) return null;

    const rows = await this.repository.listConsoleRows(sessionId);
    const ordered = orderQueue(rows);
    const nowServing = ordered.find((row) => row.status === 'in_consultation');

    if (viewer.role !== 'ADM') {
      const distinctStudentIds = new Set(rows.map((row) => row.studentId).filter((studentId): studentId is string => studentId !== null));
      for (const studentId of distinctStudentIds) {
        await this.auditRecorder.recordDataAccess({ accessorId: viewer.userId, subjectId: studentId, dataCategory: 'queueing.appointment', correlationId });
      }
    }

    return {
      sessionId: context.sessionId,
      doctorId: context.doctorId,
      doctorName: context.doctorName,
      sessionStatus: context.sessionStatus,
      nowServingSerial: nowServing?.serialNumber ?? null,
      walkInAllocationExceeded: rows.some((row) => row.exceededWalkinAllocation),
      counts: computeCounts(rows),
      queue: viewer.role === 'ADM' ? null : ordered.map((row) => ({ ...row, permittedTransitions: permittedTransitions(row.status) })),
    };
  }
}
