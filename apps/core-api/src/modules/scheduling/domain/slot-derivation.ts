/**
 * Domain layer — DR-6. FR-SCH-05: derive bookable slots from a session's
 * start time, end time and slot length, making bookable only
 * (100% − walk-in allocation) of capacity.
 *
 * `session_slot` rows are materialised for the *entire* session (BR-16's
 * walk-in capacity is real slot rows too, per `GET /sessions/{id}/slots`
 * filtering to `is_online_bookable` rather than the table only ever
 * containing bookable rows) — a walk-in appointment never claims one
 * (`ck_appointment_walkin_slot`), so the `is_online_bookable = false` rows
 * represent reserved capacity, not a claimable resource.
 *
 * Which physical time-slots are flagged non-bookable is not specified by
 * API.md or SRS.md beyond the *count* — only that
 * `bookable_slot_count = round((100 − walkInAllocationPct)% × total)`.
 * Reserving the walk-in allocation as a single block (e.g. every slot
 * after the bookable ones) would concentrate walk-in capacity at one end
 * of the session, which has no basis in the spec and models walk-in
 * arrivals (which happen throughout a session, not only at its start or
 * end) worse than an even spread does. This derivation distributes the
 * bookable slots as evenly as possible across the full session using the
 * same integer-ratio technique as pixel-line rasterisation — exactly
 * `bookableCount` of `totalCount` slots end up `true`, with no run of
 * consecutive `false` longer than necessary.
 */

export interface DerivedSlot {
  readonly slotIndex: number;
  readonly slotStartsAt: Date;
  readonly isOnlineBookable: boolean;
}

export interface SlotDerivationInput {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly slotLengthMinutes: number;
  readonly walkInAllocationPct: number;
}

export interface SlotDerivationResult {
  readonly totalSlotCount: number;
  readonly bookableSlotCount: number;
  readonly slots: readonly DerivedSlot[];
}

const MINUTES_PER_MS = 1000 * 60;

export function deriveSlots(input: SlotDerivationInput): SlotDerivationResult {
  const durationMinutes = (input.endsAt.getTime() - input.startsAt.getTime()) / MINUTES_PER_MS;
  const totalSlotCount = Math.floor(durationMinutes / input.slotLengthMinutes);
  const bookableSlotCount = Math.floor((totalSlotCount * (100 - input.walkInAllocationPct)) / 100);

  const slots: DerivedSlot[] = [];
  for (let slotIndex = 0; slotIndex < totalSlotCount; slotIndex += 1) {
    const slotStartsAt = new Date(input.startsAt.getTime() + slotIndex * input.slotLengthMinutes * MINUTES_PER_MS);
    // Evenly-distributed allocation: slot `i` is bookable exactly when the
    // running count of bookable slots through `i` increases — the standard
    // "spread N marks across M positions" technique.
    const isOnlineBookable =
      Math.floor(((slotIndex + 1) * bookableSlotCount) / totalSlotCount) >
      Math.floor((slotIndex * bookableSlotCount) / totalSlotCount);
    slots.push({ slotIndex, slotStartsAt, isOnlineBookable });
  }

  return { totalSlotCount, bookableSlotCount, slots };
}
