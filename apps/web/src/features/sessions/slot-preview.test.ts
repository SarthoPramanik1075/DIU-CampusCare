import { describe, expect, it } from 'vitest';

import { previewSlotCounts } from './slot-preview.js';

describe('previewSlotCounts', () => {
  it('matches the backend example exactly: 4 hours, 10-minute slots, 30% walk-in → 24 total, 16 bookable', () => {
    const result = previewSlotCounts(new Date('2026-08-03T09:00:00+06:00'), new Date('2026-08-03T13:00:00+06:00'), 10, 30);
    expect(result).toEqual({ totalSlotCount: 24, bookableSlotCount: 16 });
  });

  it('returns null for a non-positive duration', () => {
    expect(previewSlotCounts(new Date('2026-08-03T13:00:00Z'), new Date('2026-08-03T09:00:00Z'), 10, 30)).toBeNull();
    expect(previewSlotCounts(new Date('2026-08-03T09:00:00Z'), new Date('2026-08-03T09:00:00Z'), 10, 30)).toBeNull();
  });

  it('returns null for a non-positive slot length', () => {
    expect(previewSlotCounts(new Date('2026-08-03T09:00:00Z'), new Date('2026-08-03T13:00:00Z'), 0, 30)).toBeNull();
  });
});
