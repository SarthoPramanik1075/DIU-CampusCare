/**
 * A client-side mirror of `deriveSlots`'s count math (M2-A,
 * `apps/core-api/src/modules/scheduling/domain/slot-derivation.ts`) —
 * for F-12's live "24 slots, 17 bookable online" preview only. The
 * server remains authoritative: this never decides what gets created,
 * it only echoes back what the server would compute so staff see the
 * effect of their inputs before submitting.
 */
export interface SlotPreview {
  readonly totalSlotCount: number;
  readonly bookableSlotCount: number;
}

const MINUTES_PER_MS = 1000 * 60;

export function previewSlotCounts(startsAt: Date, endsAt: Date, slotLengthMinutes: number, walkInAllocationPct: number): SlotPreview | null {
  const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / MINUTES_PER_MS;
  if (durationMinutes <= 0 || slotLengthMinutes <= 0) return null;
  const totalSlotCount = Math.floor(durationMinutes / slotLengthMinutes);
  const bookableSlotCount = Math.floor((totalSlotCount * (100 - walkInAllocationPct)) / 100);
  return { totalSlotCount, bookableSlotCount };
}
