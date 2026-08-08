/**
 * Domain layer — DR-6. VR-10…VR-19 (SRS §3.4 "Schedules") as pure
 * predicates, mirroring `modules/iam/domain/validation.ts`'s style: one
 * evaluator per rule, shared by every handler that needs it rather than
 * re-checked inline.
 */

/** VR-10 — end strictly after start. (Time-of-day range 00:00–23:59 is guaranteed by the `HH:mm`/`timestamptz` wire format itself, not re-checked here.) */
export function isValidTimeOrder(startsAt: Date, endsAt: Date): boolean {
  return endsAt.getTime() > startsAt.getTime();
}

/** VR-11 — session duration must be at least one slot length. */
export function isAtLeastOneSlot(startsAt: Date, endsAt: Date, slotLengthMinutes: number): boolean {
  const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / (1000 * 60);
  return durationMinutes >= slotLengthMinutes;
}

/** VR-12 — slot length is an integer 5–60 minutes inclusive. */
export function isValidSlotLength(slotLengthMinutes: number): boolean {
  return Number.isInteger(slotLengthMinutes) && slotLengthMinutes >= 5 && slotLengthMinutes <= 60;
}

/** VR-13 — walk-in allocation is an integer 0–100; 100 is rejected (it would leave nothing bookable). */
export function isValidWalkInAllocation(walkInAllocationPct: number): boolean {
  return Number.isInteger(walkInAllocationPct) && walkInAllocationPct >= 0 && walkInAllocationPct <= 99;
}

/** VR-14 — publication window is an integer 1–30 days. */
export function isValidPublicationWindowDays(days: number): boolean {
  return Number.isInteger(days) && days >= 1 && days <= 30;
}

/**
 * VR-15 — a date-specific override "must fall within the publication
 * window or the future." FR-SCH-12's publication window governs how far
 * ahead *students* may view and book (P-01's projection), not a ceiling on
 * when *staff* may publish — read together, the rule reduces to "not in
 * the past": a date inside the window is explicitly fine, and so is one
 * beyond it (staff publishing next month's roster ahead of time is normal
 * operation, not an error).
 */
export function isNotInThePast(sessionDate: string, todayIsoDate: string): boolean {
  return sessionDate >= todayIsoDate;
}

/** VR-16 — unavailability range: end on/after start, not entirely in the past. */
export function isValidUnavailabilityRange(startDate: string, endDate: string, todayIsoDate: string): boolean {
  return endDate >= startDate && endDate >= todayIsoDate;
}

/** VR-18/BR-29 — a schedule change taking effect within 24 hours requires a reason of at least 10 characters (mirrors VR-93). */
export function requiresChangeReason(effectiveAt: Date, now: Date): boolean {
  const hoursUntilEffective = (effectiveAt.getTime() - now.getTime()) / (1000 * 60 * 60);
  return hoursUntilEffective < 24;
}
