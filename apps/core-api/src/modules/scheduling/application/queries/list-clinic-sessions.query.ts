import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { ClinicSessionListFilter, ClinicSessionListItem, ClinicSessionRepository } from '../clinic-session-repository.js';

const MAX_RANGE_DAYS = 60;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** `GET /api/v1/sessions` (API §3.3). */
export class ListClinicSessionsQuery {
  constructor(private readonly repository: ClinicSessionRepository) {}

  async execute(filter: ClinicSessionListFilter): Promise<Result<readonly ClinicSessionListItem[], ValidationError>> {
    const rangeDays = (new Date(`${filter.to}T00:00:00Z`).getTime() - new Date(`${filter.from}T00:00:00Z`).getTime()) / MS_PER_DAY;
    if (rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) {
      return err(
        new ValidationError({
          code: 'INVALID_DATE_RANGE',
          message: 'Choose a date range of up to 60 days.',
          fields: [{ field: 'to', rule: 'API §3.3', message: 'Must be on/after from, and at most 60 days later' }],
        }),
      );
    }

    const sessions = await this.repository.listClinicSessions(filter);
    return ok(sessions);
  }
}
