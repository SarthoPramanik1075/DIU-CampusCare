import { describe, expect, it } from 'vitest';

import { deriveSlots } from './slot-derivation.js';

function at(hhmm: string): Date {
  return new Date(`2026-08-10T${hhmm}:00Z`);
}

describe('deriveSlots — FR-SCH-05', () => {
  it('derives total and bookable counts for a typical 4-hour session', () => {
    const result = deriveSlots({
      startsAt: at('09:00'),
      endsAt: at('13:00'),
      slotLengthMinutes: 10,
      walkInAllocationPct: 30,
    });
    expect(result.totalSlotCount).toBe(24);
    expect(result.bookableSlotCount).toBe(16); // floor(24 * 70 / 100)
    expect(result.slots).toHaveLength(24);
  });

  it('rejects nothing itself but derives zero bookable slots at 99% walk-in allocation', () => {
    const result = deriveSlots({ startsAt: at('09:00'), endsAt: at('10:00'), slotLengthMinutes: 10, walkInAllocationPct: 99 });
    expect(result.totalSlotCount).toBe(6);
    expect(result.bookableSlotCount).toBe(0);
    expect(result.slots.every((slot) => !slot.isOnlineBookable)).toBe(true);
  });

  it('derives every slot bookable at 0% walk-in allocation', () => {
    const result = deriveSlots({ startsAt: at('09:00'), endsAt: at('10:00'), slotLengthMinutes: 10, walkInAllocationPct: 0 });
    expect(result.bookableSlotCount).toBe(6);
    expect(result.slots.every((slot) => slot.isOnlineBookable)).toBe(true);
  });

  it('produces exactly bookableSlotCount bookable slots, spread across the session rather than clustered', () => {
    const result = deriveSlots({ startsAt: at('09:00'), endsAt: at('13:00'), slotLengthMinutes: 10, walkInAllocationPct: 30 });
    const bookableCount = result.slots.filter((slot) => slot.isOnlineBookable).length;
    expect(bookableCount).toBe(result.bookableSlotCount);

    // No run of consecutive non-bookable slots longer than a small bound —
    // proof the allocation is spread, not concentrated at one end.
    let longestNonBookableRun = 0;
    let currentRun = 0;
    for (const slot of result.slots) {
      currentRun = slot.isOnlineBookable ? 0 : currentRun + 1;
      longestNonBookableRun = Math.max(longestNonBookableRun, currentRun);
    }
    expect(longestNonBookableRun).toBeLessThanOrEqual(2);
  });

  it('sets each slot start time slot-length minutes apart, starting at the session start', () => {
    const result = deriveSlots({ startsAt: at('09:00'), endsAt: at('09:30'), slotLengthMinutes: 10, walkInAllocationPct: 0 });
    expect(result.slots.map((slot) => slot.slotStartsAt.toISOString())).toEqual([
      at('09:00').toISOString(),
      at('09:10').toISOString(),
      at('09:20').toISOString(),
    ]);
  });

  it('assigns sequential slotIndex starting at 0', () => {
    const result = deriveSlots({ startsAt: at('09:00'), endsAt: at('09:30'), slotLengthMinutes: 10, walkInAllocationPct: 0 });
    expect(result.slots.map((slot) => slot.slotIndex)).toEqual([0, 1, 2]);
  });

  it('floors a duration that is not an exact multiple of the slot length', () => {
    const result = deriveSlots({ startsAt: at('09:00'), endsAt: at('09:25'), slotLengthMinutes: 10, walkInAllocationPct: 0 });
    expect(result.totalSlotCount).toBe(2);
  });

  it.each([5, 10, 15, 20, 30, 60])('derives a sane result for slot length %i minutes across a 4-hour session', (slotLengthMinutes) => {
    const result = deriveSlots({ startsAt: at('09:00'), endsAt: at('13:00'), slotLengthMinutes, walkInAllocationPct: 30 });
    expect(result.totalSlotCount).toBe(Math.floor(240 / slotLengthMinutes));
    expect(result.bookableSlotCount).toBeLessThanOrEqual(result.totalSlotCount);
    expect(result.bookableSlotCount).toBeGreaterThanOrEqual(0);
  });
});
