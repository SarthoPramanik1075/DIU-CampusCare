import { describe, expect, it } from 'vitest';

import {
  isAtLeastOneSlot,
  isNotInThePast,
  isValidPublicationWindowDays,
  isValidSlotLength,
  isValidTimeOrder,
  isValidUnavailabilityRange,
  isValidWalkInAllocation,
  requiresChangeReason,
} from './validation.js';

describe('isValidTimeOrder — VR-10', () => {
  it('requires end strictly after start', () => {
    expect(isValidTimeOrder(new Date('2026-08-10T09:00:00Z'), new Date('2026-08-10T13:00:00Z'))).toBe(true);
    expect(isValidTimeOrder(new Date('2026-08-10T09:00:00Z'), new Date('2026-08-10T09:00:00Z'))).toBe(false);
    expect(isValidTimeOrder(new Date('2026-08-10T13:00:00Z'), new Date('2026-08-10T09:00:00Z'))).toBe(false);
  });
});

describe('isAtLeastOneSlot — VR-11', () => {
  it('accepts a session at least as long as one slot', () => {
    expect(isAtLeastOneSlot(new Date('2026-08-10T09:00:00Z'), new Date('2026-08-10T09:10:00Z'), 10)).toBe(true);
  });

  it('rejects a session shorter than one slot', () => {
    expect(isAtLeastOneSlot(new Date('2026-08-10T09:00:00Z'), new Date('2026-08-10T09:05:00Z'), 10)).toBe(false);
  });
});

describe('isValidSlotLength — VR-12', () => {
  it('accepts integers 5–60 inclusive', () => {
    expect(isValidSlotLength(5)).toBe(true);
    expect(isValidSlotLength(60)).toBe(true);
    expect(isValidSlotLength(10)).toBe(true);
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(isValidSlotLength(4)).toBe(false);
    expect(isValidSlotLength(61)).toBe(false);
    expect(isValidSlotLength(10.5)).toBe(false);
  });
});

describe('isValidWalkInAllocation — VR-13', () => {
  it('accepts 0–99 inclusive', () => {
    expect(isValidWalkInAllocation(0)).toBe(true);
    expect(isValidWalkInAllocation(30)).toBe(true);
    expect(isValidWalkInAllocation(99)).toBe(true);
  });

  it('rejects 100 — no slots would be bookable', () => {
    expect(isValidWalkInAllocation(100)).toBe(false);
  });

  it('rejects negative and non-integer values', () => {
    expect(isValidWalkInAllocation(-1)).toBe(false);
    expect(isValidWalkInAllocation(30.5)).toBe(false);
  });
});

describe('isValidPublicationWindowDays — VR-14', () => {
  it('accepts 1–30 inclusive', () => {
    expect(isValidPublicationWindowDays(1)).toBe(true);
    expect(isValidPublicationWindowDays(30)).toBe(true);
  });

  it('rejects 0 and values above 30', () => {
    expect(isValidPublicationWindowDays(0)).toBe(false);
    expect(isValidPublicationWindowDays(31)).toBe(false);
  });
});

describe('isNotInThePast — VR-15', () => {
  it('accepts today and future dates', () => {
    expect(isNotInThePast('2026-08-10', '2026-08-10')).toBe(true);
    expect(isNotInThePast('2026-09-01', '2026-08-10')).toBe(true);
  });

  it('rejects a date before today', () => {
    expect(isNotInThePast('2026-08-09', '2026-08-10')).toBe(false);
  });
});

describe('isValidUnavailabilityRange — VR-16', () => {
  it('accepts end on/after start and not entirely in the past', () => {
    expect(isValidUnavailabilityRange('2026-08-20', '2026-08-24', '2026-08-10')).toBe(true);
    expect(isValidUnavailabilityRange('2026-08-20', '2026-08-20', '2026-08-10')).toBe(true);
  });

  it('rejects end before start', () => {
    expect(isValidUnavailabilityRange('2026-08-24', '2026-08-20', '2026-08-10')).toBe(false);
  });

  it('rejects a range entirely in the past', () => {
    expect(isValidUnavailabilityRange('2026-08-01', '2026-08-05', '2026-08-10')).toBe(false);
  });
});

describe('requiresChangeReason — VR-18/BR-29', () => {
  it('requires a reason when the change takes effect within 24 hours', () => {
    const now = new Date('2026-08-10T09:00:00Z');
    expect(requiresChangeReason(new Date('2026-08-10T20:00:00Z'), now)).toBe(true);
  });

  it('does not require a reason more than 24 hours out', () => {
    const now = new Date('2026-08-10T09:00:00Z');
    expect(requiresChangeReason(new Date('2026-08-12T09:00:00Z'), now)).toBe(false);
  });
});
