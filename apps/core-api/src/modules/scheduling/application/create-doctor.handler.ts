import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isNonEmptyAfterTrim } from '../domain/validation.js';

import type { DoctorDetail, DoctorRepository } from './doctor-repository.js';

export interface CreateDoctorCommandInput {
  readonly fullName: string;
  readonly designation: string | null;
  readonly specialisation: string | null;
  readonly photoUrl: string | null;
  readonly userAccountId: string | null;
  /** API §3.1: optional, "defaults to [the] single Phase 1 location" when omitted. */
  readonly locationId: string | undefined;
  readonly actorId: string;
  readonly correlationId: string;
}

/** `POST /api/v1/doctors` (API §3.1, FR-SCH-01). */
export class CreateDoctorHandler {
  constructor(
    private readonly repository: DoctorRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: CreateDoctorCommandInput): Promise<Result<DoctorDetail, ValidationError | DomainRuleViolation>> {
    if (!isNonEmptyAfterTrim(input.fullName)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a full name.',
          fields: [{ field: 'fullName', rule: 'VALIDATION_FAILED', message: 'Non-empty after trimming' }],
        }),
      );
    }

    if (input.userAccountId !== null && (await this.repository.isUserAccountLinked(input.userAccountId))) {
      return err(
        new DomainRuleViolation({
          code: 'ACCOUNT_ALREADY_LINKED',
          message: 'That account is already linked to a different doctor profile.',
        }),
      );
    }

    const locationId = input.locationId ?? (await this.repository.findDefaultLocationId());
    const result = await this.repository.createDoctor({
      fullName: input.fullName.trim(),
      designation: input.designation,
      specialisation: input.specialisation,
      photoUrl: input.photoUrl,
      userAccountId: input.userAccountId,
      locationId,
    });

    if (result.outcome === 'account_already_linked') {
      return err(
        new DomainRuleViolation({
          code: 'ACCOUNT_ALREADY_LINKED',
          message: 'That account is already linked to a different doctor profile.',
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.doctor',
      entityId: result.doctor.doctorId,
      action: 'created',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(result.doctor);
  }
}
