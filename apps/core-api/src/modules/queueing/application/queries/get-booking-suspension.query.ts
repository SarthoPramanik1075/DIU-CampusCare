import type { Clock } from '../../../../kernel/clock/clock.js';
import type { BookingSuspensionRepository } from '../booking-suspension-repository.js';

export interface BookingSuspensionState {
  readonly suspendedUntil: Date;
  readonly reason: string;
  /** FR-APT-13 — never conditional. A suspension only ever affects online booking. */
  readonly walkInRemainsAvailable: true;
}

/** `GET /api/v1/me/booking-suspension` (API §4.1, S-14). Mirrors `modules/dashboard`'s own `findActiveBookingSuspension` reasoning exactly: `identity.booking_suspension` has no free-text reason column, so the notice is derived from `noShowCount`, never fabricated. */
export class GetBookingSuspensionQuery {
  constructor(
    private readonly repository: BookingSuspensionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(studentId: string): Promise<BookingSuspensionState | null> {
    const detail = await this.repository.findActiveSuspensionDetail(studentId, this.clock.now());
    if (detail === null) return null;

    return {
      suspendedUntil: detail.suspendedUntil,
      reason: `Missed ${String(detail.noShowCount)} appointment${detail.noShowCount === 1 ? '' : 's'} without notice.`,
      walkInRemainsAvailable: true,
    };
  }
}
