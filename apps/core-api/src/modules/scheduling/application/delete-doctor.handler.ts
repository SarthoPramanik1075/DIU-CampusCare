import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { AuthorizationError } from '../../../kernel/errors/domain-error.js';
import { DomainRuleViolation } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isDeletable } from '../domain/doctor.js';

import type { DoctorRepository } from './doctor-repository.js';
import { doctorNotFoundError } from './update-doctor.handler.js';

export interface DeleteDoctorInput {
  readonly doctorId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

/** `DELETE /api/v1/doctors/{id}` (API §3.1, EC-20). Permitted only when no appointment has ever referenced the doctor. */
export class DeleteDoctorHandler {
  constructor(
    private readonly repository: DoctorRepository,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: DeleteDoctorInput): Promise<Result<undefined, DomainRuleViolation | AuthorizationError>> {
    const appointmentCount = await this.repository.countAppointmentHistory(input.doctorId);
    if (!isDeletable(appointmentCount)) {
      return err(
        new DomainRuleViolation({
          code: 'DOCTOR_HAS_HISTORY',
          message: `This doctor has ${String(appointmentCount)} appointment record${appointmentCount === 1 ? '' : 's'} and can't be deleted. Deactivate the profile instead — the records stay intact.`,
          details: { affectedRecords: appointmentCount },
        }),
      );
    }

    const outcome = await this.repository.deleteDoctor(input.doctorId);
    if (outcome.outcome === 'not_found') return err(doctorNotFoundError());

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.doctor',
      entityId: input.doctorId,
      action: 'deleted',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(undefined);
  }
}
