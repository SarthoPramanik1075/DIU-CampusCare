import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { AuthorizationError, ConflictError, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isNonEmptyAfterTrim } from '../domain/validation.js';

import type { DoctorDetail, DoctorRepository } from './doctor-repository.js';

export interface UpdateDoctorCommandInput {
  readonly doctorId: string;
  readonly fullName: string | undefined;
  readonly designation: string | null | undefined;
  readonly specialisation: string | null | undefined;
  readonly photoUrl: string | null | undefined;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export function doctorNotFoundError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That doctor could not be found.', httpStatus: 404 });
}

/** `PATCH /api/v1/doctors/{id}` (API §3.1). */
export class UpdateDoctorHandler {
  constructor(
    private readonly repository: DoctorRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: UpdateDoctorCommandInput): Promise<Result<DoctorDetail, ValidationError | ConflictError | AuthorizationError>> {
    if (input.fullName !== undefined && !isNonEmptyAfterTrim(input.fullName)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a full name.',
          fields: [{ field: 'fullName', rule: 'VALIDATION_FAILED', message: 'Non-empty after trimming' }],
        }),
      );
    }

    const outcome = await this.repository.updateDoctor({
      doctorId: input.doctorId,
      fullName: input.fullName?.trim(),
      designation: input.designation,
      specialisation: input.specialisation,
      photoUrl: input.photoUrl,
      expectedVersion: input.expectedVersion,
    });

    if (outcome.outcome === 'not_found') return err(doctorNotFoundError());

    if (outcome.outcome === 'stale') {
      const current = await this.repository.findDoctorDetailById(input.doctorId);
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else updated this a moment ago. Here is the current version — review it and try again.',
          ...(current === null ? {} : { details: { current } }),
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.doctor',
      entityId: input.doctorId,
      action: 'updated',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.doctor);
  }
}
