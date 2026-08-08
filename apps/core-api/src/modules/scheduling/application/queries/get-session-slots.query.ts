import { AuthorizationError } from '../../../../kernel/errors/domain-error.js';
import type { PolicyStore } from '../../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { ClinicSessionRepository, SessionSlotItem } from '../clinic-session-repository.js';

export interface SessionSlotsResult {
  readonly sessionId: string;
  readonly slotLengthMinutes: number;
  readonly bookingClosesAt: Date;
  readonly items: readonly SessionSlotItem[];
  readonly summary: { readonly bookable: number; readonly booked: number; readonly remaining: number };
}

const MINUTES_PER_MS = 1000 * 60;

/**
 * `GET /api/v1/sessions/{id}/slots` (API §3.3, FR-SCH-05, FR-APT-01).
 * `bookingClosesAt` defaults to the session's own start time (FR-APT-11) —
 * the configured cutoff is a policy value (DR-4), not a literal, even
 * though its Phase-1 default is zero minutes before start.
 */
export class GetSessionSlotsQuery {
  constructor(
    private readonly repository: ClinicSessionRepository,
    private readonly policyStore: PolicyStore,
  ) {}

  async execute(sessionId: string, availableOnly: boolean): Promise<Result<SessionSlotsResult, AuthorizationError>> {
    const session = await this.repository.findClinicSessionById(sessionId);
    if (session === null) {
      return err(new AuthorizationError({ code: 'NOT_FOUND', message: 'That session could not be found.', httpStatus: 404 }));
    }

    const allItems = await this.repository.listSessionSlots(sessionId);
    const bookedCount = allItems.filter((item) => !item.isAvailable).length;
    const items = availableOnly ? allItems.filter((item) => item.isAvailable) : allItems;

    const cutoffMinutes = await this.policyStore.getRequiredInteger('scheduling.session.bookingCutoffMinutesBeforeStart');
    const bookingClosesAt = new Date(session.startsAt.getTime() - cutoffMinutes * MINUTES_PER_MS);

    return ok({
      sessionId,
      slotLengthMinutes: session.slotLengthMinutes,
      bookingClosesAt,
      items,
      summary: { bookable: allItems.length, booked: bookedCount, remaining: allItems.length - bookedCount },
    });
  }
}
