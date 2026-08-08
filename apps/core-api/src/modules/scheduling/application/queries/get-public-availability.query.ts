import type { Clock } from '../../../../kernel/clock/clock.js';
import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import type { PolicyStore } from '../../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { ClinicSessionRepository, PublicAvailabilityDay } from '../clinic-session-repository.js';

export interface PublicAvailabilityResult {
  readonly days: readonly PublicAvailabilityDay[];
  readonly asOf: Date;
  readonly publicationWindowDays: number;
}

const DEFAULT_RANGE_DAYS = 6;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function addDays(isoDate: string, days: number): string {
  return new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * `GET /api/v1/public/availability` (API §2.2, FR-DASH-06, FR-UI-05).
 * `to` is silently clamped to the configured publication window rather
 * than rejected — a longer range is a client asking for more than it's
 * allowed to see, not a malformed request.
 */
export class GetPublicAvailabilityQuery {
  constructor(
    private readonly repository: ClinicSessionRepository,
    private readonly policyStore: PolicyStore,
    private readonly clock: Clock,
  ) {}

  async execute(from: string | undefined, to: string | undefined, doctorId: string | undefined): Promise<Result<PublicAvailabilityResult, ValidationError>> {
    const today = this.clock.now().toISOString().slice(0, 10);
    const resolvedFrom = from ?? today;
    if (resolvedFrom < today) {
      return err(new ValidationError({ code: 'INVALID_DATE_RANGE', message: 'Choose a date from today onwards.', fields: [{ field: 'from', rule: 'API §2.2', message: 'Must not be in the past' }] }));
    }
    if (to !== undefined && to < resolvedFrom) {
      return err(new ValidationError({ code: 'INVALID_DATE_RANGE', message: 'Choose a date from today onwards.', fields: [{ field: 'to', rule: 'API §2.2', message: 'Must be on/after from' }] }));
    }

    const publicationWindowDays = await this.policyStore.getRequiredInteger('scheduling.publicationWindowDays');
    const maxTo = addDays(today, publicationWindowDays - 1);
    const requestedTo = to ?? addDays(resolvedFrom, DEFAULT_RANGE_DAYS);
    const resolvedTo = requestedTo > maxTo ? maxTo : requestedTo;

    const locationId = await this.repository.findDefaultLocationId();
    const days = await this.repository.listPublicAvailability(locationId, resolvedFrom, resolvedTo < resolvedFrom ? resolvedFrom : resolvedTo, doctorId);

    return ok({ days, asOf: this.clock.now(), publicationWindowDays });
  }
}
