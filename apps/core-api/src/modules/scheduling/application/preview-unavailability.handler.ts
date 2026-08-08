import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isValidReason, isValidUnavailabilityRange } from '../domain/validation.js';

import type { AlternativeAvailabilityEntry, UnavailabilityRepository } from './unavailability-repository.js';

export interface PreviewUnavailabilityCommandInput {
  readonly doctorId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
  readonly actorId: string;
  readonly correlationId: string;
}

/** Public shape (API §3.4) — never `appointmentId`/`studentId`, only what staff need to read and act on. */
export interface PreviewAffectedAppointment {
  readonly appointmentRef: string;
  readonly studentRef: string | null;
  readonly studentName: string | null;
  readonly sessionDate: string;
  readonly serialNumber: number;
  readonly paymentStatus: string;
  readonly requiresRefundFlag: boolean;
}

export interface PreviewUnavailabilityResult {
  readonly previewToken: string;
  readonly expiresAt: Date;
  readonly affectedSessions: number;
  readonly affectedAppointments: readonly PreviewAffectedAppointment[];
  readonly alternativeAvailability: readonly AlternativeAvailabilityEntry[];
}

const PREVIEW_TTL_MINUTES = 15;

export function doctorNotFoundForUnavailabilityError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That doctor could not be found.', httpStatus: 404 });
}

/**
 * `POST /api/v1/doctors/{id}/unavailability/impact-preview` (API §3.4,
 * step 1 of 2). Writes no state change and no unavailability row — only
 * a short-lived preview row and `audit.data_access_log`, since this
 * reveals other students' identities to staff (FR-AUD-03).
 */
export class PreviewUnavailabilityHandler {
  constructor(
    private readonly repository: UnavailabilityRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: PreviewUnavailabilityCommandInput): Promise<Result<PreviewUnavailabilityResult, ValidationError | DomainRuleViolation | AuthorizationError>> {
    const today = this.clock.now().toISOString().slice(0, 10);
    if (!isValidUnavailabilityRange(input.startDate, input.endDate, today)) {
      return err(
        new ValidationError({
          code: 'INVALID_DATE_RANGE',
          message: "Choose a date range that ends on or after it starts, and isn't entirely in the past.",
          fields: [{ field: 'endDate', rule: 'VR-16', message: 'Must be on/after startDate and not entirely in the past' }],
        }),
      );
    }
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Required' }],
        }),
      );
    }

    if (!(await this.repository.doctorExists(input.doctorId))) return err(doctorNotFoundForUnavailabilityError());

    const conflict = await this.repository.findOverlappingUnavailability(input.doctorId, input.startDate, input.endDate);
    if (conflict !== null) {
      return err(
        new DomainRuleViolation({
          code: 'UNAVAILABILITY_OVERLAP',
          message: `This doctor already has leave recorded from ${conflict.startDate} to ${conflict.endDate}.`,
          details: { conflicting: conflict },
        }),
      );
    }

    const impact = await this.repository.computeImpact(input.doctorId, input.startDate, input.endDate);
    const expiresAt = new Date(this.clock.now().getTime() + PREVIEW_TTL_MINUTES * 60 * 1000);
    const { previewToken } = await this.repository.createPreview(
      input.doctorId,
      input.startDate,
      input.endDate,
      input.reason,
      impact.affectedAppointments.map((appointment) => appointment.appointmentId),
      expiresAt,
    );

    const distinctStudentIds = [...new Set(impact.affectedAppointments.map((appointment) => appointment.studentId).filter((studentId): studentId is string => studentId !== null))];
    for (const studentId of distinctStudentIds) {
      await this.auditRecorder.recordDataAccess({ accessorId: input.actorId, subjectId: studentId, dataCategory: 'queueing.appointment', correlationId: input.correlationId });
    }

    return ok({
      previewToken,
      expiresAt,
      affectedSessions: impact.affectedSessions,
      affectedAppointments: impact.affectedAppointments.map((appointment) => ({
        appointmentRef: appointment.appointmentRef,
        studentRef: appointment.studentRef,
        studentName: appointment.studentName,
        sessionDate: appointment.sessionDate,
        serialNumber: appointment.serialNumber,
        paymentStatus: appointment.paymentStatus,
        requiresRefundFlag: appointment.requiresRefundFlag,
      })),
      alternativeAvailability: impact.alternativeAvailability,
    });
  }
}
