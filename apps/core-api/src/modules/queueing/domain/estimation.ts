/**
 * Domain layer — DR-6. FR-APT-22's estimation engine and its supporting
 * rules (EC-14/EC-15, BR-20/FR-APT-24), as pure functions over plain
 * numbers and dates. The actual consultation-duration history is read by
 * the repository layer; this file only ever computes from what it is
 * given.
 */

const MINUTES_PER_MS = 1000 * 60;
const MIN_CONSULTATIONS_FOR_SESSION_MEAN = 3;

/** EC-15 — durations exceeding `anomalyMultiplier` × the slot length are excluded from the rolling mean (and, per EC-15, flagged to staff — that flagging is a repository/query concern, not this pure filter's). */
export function filterAnomalousDurations(
  durationsMinutes: readonly number[],
  slotLengthMinutes: number,
  anomalyMultiplier: number,
): { readonly included: readonly number[]; readonly excludedCount: number } {
  const ceiling = slotLengthMinutes * anomalyMultiplier;
  const included = durationsMinutes.filter((duration) => duration <= ceiling);
  return { included, excludedCount: durationsMinutes.length - included.length };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * FR-APT-22: rolling mean of the *current session's* completed
 * consultations; below {@link MIN_CONSULTATIONS_FOR_SESSION_MEAN} (EC-14's
 * "no historical data" case, generalised — a session barely underway is
 * data-poor the same way a brand-new doctor is), fall back to the doctor's
 * trailing 30-day mean; below that, the configured slot length. Never
 * less than the slot length either way.
 *
 * `currentSessionDurationsMinutes` and `doctorTrailingMeanMinutes` are both
 * expected to already have gone through {@link filterAnomalousDurations} —
 * this function does not re-filter, so a caller passing raw durations
 * would silently let outliers back in.
 */
export function computeMeanConsultationDurationMinutes(
  currentSessionDurationsMinutes: readonly number[],
  doctorTrailingMeanMinutes: number | null,
  slotLengthMinutes: number,
): number {
  const base =
    currentSessionDurationsMinutes.length >= MIN_CONSULTATIONS_FOR_SESSION_MEAN
      ? mean(currentSessionDurationsMinutes)
      : (doctorTrailingMeanMinutes ?? slotLengthMinutes);
  return Math.max(base, slotLengthMinutes);
}

/** FR-APT-20/21 — a waiting patient's estimate: now plus one mean-duration slot per patient ahead of them. */
export function estimateForPosition(now: Date, patientsAhead: number, meanConsultationDurationMinutes: number): Date {
  return new Date(now.getTime() + patientsAhead * meanConsultationDurationMinutes * MINUTES_PER_MS);
}

/** BR-20/FR-APT-24 — the estimate has slipped more than the configured threshold (default 30 min) from what the student was told at booking time. */
export function hasEstimateSlipped(estimateAtBooking: Date, currentEstimate: Date, slipThresholdMinutes: number): boolean {
  const slipMinutes = (currentEstimate.getTime() - estimateAtBooking.getTime()) / MINUTES_PER_MS;
  return slipMinutes > slipThresholdMinutes;
}

/**
 * Whether a slip notification should fire now. Scoped deliberately to a
 * single notification per appointment rather than FR-APT-24's literal
 * "and again per subsequent 30-minute cumulative slip": `last_slip_notified_at`
 * (the only column this schema carries for it) records *that* a
 * notification fired, not *what the estimate was* when it did, so there is
 * nothing to compare a new slip against to know whether it has grown by
 * another full threshold since. Notifying once, honestly, beats
 * approximating a cumulative count this storage can't support.
 */
export function shouldNotifySlip(estimateAtBooking: Date, currentEstimate: Date, lastSlipNotifiedAt: Date | null, slipThresholdMinutes: number): boolean {
  return lastSlipNotifiedAt === null && hasEstimateSlipped(estimateAtBooking, currentEstimate, slipThresholdMinutes);
}
