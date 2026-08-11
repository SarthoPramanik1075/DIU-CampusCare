/**
 * Domain layer — DR-6. VR-20…27 (SRS §3.6 "Appointments & queue") as pure
 * predicates, mirroring `modules/scheduling/domain/validation.ts`'s style.
 * Every predicate here is given the data it needs (a timestamp, a count, a
 * policy value) rather than reaching for it — the actual DB reads live in
 * the repository/handler layer.
 */

const MAX_VISIT_REASON_NOTE_LENGTH = 200;
const MINIMUM_REASON_LENGTH = 10;

/** VR-30/VR-32/VR-93 — every mandatory reason field (emergency designation, status reversal): minimum 10 characters after trimming. Mirrors `modules/scheduling/domain/validation.ts`'s helper of the same name (DR-2 — kept module-local). */
export function isValidReason(reason: string): boolean {
  return reason.trim().length >= MINIMUM_REASON_LENGTH;
}

/** VR-20 — a slot committed to must be in the future at the moment of commit. The "unbooked at commit" half of VR-20 is enforced by `uq_appointment_slot_active`, not here — no application check can make that race-free by itself. */
export function isSlotInFuture(slotStartsAt: Date, now: Date): boolean {
  return slotStartsAt.getTime() > now.getTime();
}

/** VR-20 — a slot must fall within the publication window (OI-07) counted from today. */
export function isWithinPublicationWindow(sessionDate: string, todayIsoDate: string, publicationWindowDays: number): boolean {
  const today = new Date(`${todayIsoDate}T00:00:00Z`);
  const windowEnd = new Date(today.getTime() + publicationWindowDays * 24 * 60 * 60 * 1000);
  return sessionDate >= todayIsoDate && new Date(`${sessionDate}T00:00:00Z`).getTime() <= windowEnd.getTime();
}

/** VR-24 — booking closes at the configured cutoff before session start (FR-APT-11, OI-09). */
export function isBeforeBookingCutoff(sessionStartsAt: Date, cutoffMinutesBeforeStart: number, now: Date): boolean {
  const cutoff = new Date(sessionStartsAt.getTime() - cutoffMinutesBeforeStart * 60 * 1000);
  return now.getTime() < cutoff.getTime();
}

/** VR-21/BR-11 — at most `max` simultaneously active bookings (OI-08). */
export function isBelowMaxActiveBookings(currentActiveCount: number, maxActiveBookings: number): boolean {
  return currentActiveCount < maxActiveBookings;
}

/** VR-23 — must not be under an active booking suspension (FR-APT-12). */
export function isUnderActiveSuspension(suspendedUntil: Date | null, now: Date): boolean {
  return suspendedUntil !== null && suspendedUntil.getTime() > now.getTime();
}

/** VR-25 — free-text reason-for-visit note, if given, is at most 200 characters. */
export function isValidVisitReasonNote(note: string | null): boolean {
  return note === null || note.length <= MAX_VISIT_REASON_NOTE_LENGTH;
}

export type CancellationClassification = 'cancelled' | 'late_cancellation';

/** BR-12/FR-APT-16 — free cancellation at least `cutoffMinutes` (OI-09, default 120) before the estimated time; later is a `late_cancellation`, which never carries a penalty either way (FR-APT-18). */
export function classifyCancellation(estimatedAt: Date, cutoffMinutes: number, now: Date): CancellationClassification {
  const cutoff = new Date(estimatedAt.getTime() - cutoffMinutes * 60 * 1000);
  return now.getTime() < cutoff.getTime() ? 'cancelled' : 'late_cancellation';
}

/** VR-31/BR-14 — No-show may only be marked after the configured grace period has elapsed since the patient was called (OI-10). */
export function hasGracePeriodElapsed(calledAt: Date, gracePeriodMinutes: number, now: Date): boolean {
  const elapsedMinutes = (now.getTime() - calledAt.getTime()) / (1000 * 60);
  return elapsedMinutes >= gracePeriodMinutes;
}

export function remainingGracePeriodSeconds(calledAt: Date, gracePeriodMinutes: number, now: Date): number {
  const graceEndsAt = calledAt.getTime() + gracePeriodMinutes * 60 * 1000;
  return Math.max(0, Math.ceil((graceEndsAt - now.getTime()) / 1000));
}
