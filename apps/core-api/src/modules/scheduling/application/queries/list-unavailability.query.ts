import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { UnavailabilityRecord, UnavailabilityRepository } from '../unavailability-repository.js';

/** `GET /api/v1/doctors/{id}/unavailability` (API §3.4, FR-SCH-06). */
export class ListUnavailabilityQuery {
  constructor(private readonly repository: UnavailabilityRepository) {}

  async execute(doctorId: string, from: string, to: string): Promise<Result<readonly UnavailabilityRecord[], ValidationError>> {
    if (to < from) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'The "to" date must be on or after the "from" date.',
          fields: [{ field: 'to', rule: 'API §3.4', message: 'Must be on/after from' }],
        }),
      );
    }

    const items = await this.repository.listUnavailability(doctorId, from, to);
    return ok(items);
  }
}
