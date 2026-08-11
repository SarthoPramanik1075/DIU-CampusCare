/**
 * Domain layer — DR-6. BR-15: 3 No-shows within a rolling 30-day window
 * suspends *online booking* for 14 days; walk-in access is never affected
 * (FR-APT-13) — that guarantee lives in the booking-suspension check
 * simply never being consulted anywhere on the walk-in path, not in
 * anything this file does.
 */

/** The count already includes the No-show just marked — the caller counts *after* recording it, not before. */
export function shouldSuspendForNoShows(recentNoShowCount: number, thresholdCount: number): boolean {
  return recentNoShowCount >= thresholdCount;
}

export function computeSuspensionUntil(now: Date, durationDays: number): Date {
  return new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
}

export function computeSuspensionWindowStart(now: Date, windowDays: number): Date {
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
}
