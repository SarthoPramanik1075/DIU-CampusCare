import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import { isValidDateOrder } from '../../domain/service-calendar.js';
import type { ServiceCalendarEntry } from '../../domain/service-calendar.js';
import type { ServiceCalendarRepository } from '../service-calendar-repository.js';

/** `GET /api/v1/service-calendar` (API §8.3 maintenance view, FR-SCH-10, FR-ADM-03). */
export class ListServiceCalendarQuery {
  constructor(private readonly repository: ServiceCalendarRepository) {}

  async execute(from: string, to: string): Promise<Result<readonly ServiceCalendarEntry[], ValidationError>> {
    if (!isValidDateOrder(from, to)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'The "to" date must be on or after the "from" date.',
          fields: [{ field: 'to', rule: 'API §8.3', message: 'Must be on/after from' }],
        }),
      );
    }

    const locationId = await this.repository.findDefaultLocationId();
    const items = await this.repository.listEntries(locationId, from, to);
    return ok(items);
  }
}
