import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { AuthorizationError } from '../../../kernel/errors/domain-error.js';
import { ConflictError, DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { canDeactivate } from '../domain/doctor.js';
import { isValidReason } from '../domain/validation.js';

import type { DoctorDetail, DoctorRepository } from './doctor-repository.js';
import { doctorNotFoundError } from './update-doctor.handler.js';

export interface DeactivateDoctorInput {
  readonly doctorId: string;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface DeactivateDoctorResult {
  readonly doctor: DoctorDetail;
  readonly affectedUpcomingSessions: number;
}

/**
 * `POST /api/v1/doctors/{id}/deactivate` (API §3.1). Deliberately does
 * **not** cancel upcoming sessions or bookings — that would bypass
 * FR-SCH-07's mandatory impact preview (M2-F's two-step leave flow).
 * `affectedUpcomingSessions` is reported so staff know to follow up
 * through that flow, not acted on here.
 */
export class DeactivateDoctorHandler {
  constructor(
    private readonly repository: DoctorRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: DeactivateDoctorInput): Promise<Result<DeactivateDoctorResult, ValidationError | ConflictError | DomainRuleViolation | AuthorizationError>> {
    if (!isValidReason(input.reason)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a reason of at least 10 characters.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Minimum 10 characters after trimming' }],
        }),
      );
    }

    const current = await this.repository.findDoctorDetailById(input.doctorId);
    if (current === null) return err(doctorNotFoundError());
    if (!canDeactivate(current.isActive)) {
      return err(new DomainRuleViolation({ code: 'ALREADY_INACTIVE', message: 'This doctor is already inactive.' }));
    }

    const outcome = await this.repository.deactivateDoctor(input.doctorId, input.expectedVersion);
    if (outcome.outcome === 'not_found') return err(doctorNotFoundError());
    if (outcome.outcome === 'stale') {
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else updated this a moment ago. Here is the current version — review it and try again.',
          details: { current },
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.doctor',
      entityId: input.doctorId,
      action: 'deactivated',
      afterState: { reason: input.reason },
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok({ doctor: outcome.doctor, affectedUpcomingSessions: outcome.affectedUpcomingSessions });
  }
}
