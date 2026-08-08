import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import { isValidDateOrder, rangeDaysInclusive } from '../../domain/service-calendar.js';
import type { ServiceCalendarEntry } from '../../domain/service-calendar.js';
import type { ServiceCalendarRepository } from '../service-calendar-repository.js';

const MAX_RANGE_DAYS = 90;

/** `GET /api/v1/public/service-calendar` (API §2.6, FR-SCH-10/11, BR-28) — unauthenticated, so a student can see closures before attempting to book. */
export class GetPublicServiceCalendarQuery {
  constructor(private readonly repository: ServiceCalendarRepository) {}

  async execute(from: string, to: string): Promise<Result<readonly ServiceCalendarEntry[], ValidationError>> {
    if (!isValidDateOrder(from, to) || rangeDaysInclusive(from, to) > MAX_RANGE_DAYS) {
      return err(
        new ValidationError({
          code: 'INVALID_DATE_RANGE',
          message: 'Choose a date range of up to 90 days.',
          fields: [{ field: 'to', rule: 'API §2.6', message: 'Must be on/after from, within 90 days' }],
        }),
      );
    }

    const locationId = await this.repository.findDefaultLocationId();
    return ok(await this.repository.listEntries(locationId, from, to));
  }
}
