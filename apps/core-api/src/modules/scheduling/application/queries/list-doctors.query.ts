import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { DoctorListFilter, DoctorListPage, DoctorRepository } from '../doctor-repository.js';

/** API §0.8: lists default to 50, cap at 200 — a protocol convention, not a tunable business policy (DR-4 doesn't apply). */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MINIMUM_QUERY_LENGTH = 2;

export type ListDoctorsInput = Omit<DoctorListFilter, 'limit'> & { readonly limit?: number };

/** `GET /api/v1/doctors` (API §3.1, FR-SCH-01). */
export class ListDoctorsQuery {
  constructor(private readonly repository: DoctorRepository) {}

  async execute(input: ListDoctorsInput): Promise<Result<DoctorListPage, ValidationError>> {
    if (input.q !== undefined && input.q.trim().length < MINIMUM_QUERY_LENGTH) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Search text must be at least 2 characters.',
          fields: [{ field: 'q', rule: 'API §3.1', message: 'Minimum 2 characters' }],
        }),
      );
    }

    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const page = await this.repository.listDoctors({ ...input, limit });
    return ok(page);
  }
}
