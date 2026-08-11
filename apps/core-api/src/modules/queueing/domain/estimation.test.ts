import { describe, expect, it } from 'vitest';

import { computeMeanConsultationDurationMinutes, estimateForPosition, filterAnomalousDurations, hasEstimateSlipped, shouldNotifySlip } from './estimation.js';

describe('filterAnomalousDurations — EC-15', () => {
  it('keeps durations at or below the anomaly ceiling', () => {
    const result = filterAnomalousDurations([5, 10, 40], 10, 4);
    expect(result.included).toEqual([5, 10, 40]);
    expect(result.excludedCount).toBe(0);
  });

  it('excludes durations beyond the multiplier and counts them', () => {
    const result = filterAnomalousDurations([5, 10, 41, 100], 10, 4);
    expect(result.included).toEqual([5, 10]);
    expect(result.excludedCount).toBe(2);
  });
});

describe('computeMeanConsultationDurationMinutes — FR-APT-22', () => {
  it('uses the current session mean once at least 3 consultations have completed', () => {
    expect(computeMeanConsultationDurationMinutes([8, 10, 12], 20, 10)).toBe(10);
  });

  it('falls back to the doctor’s trailing mean below 3 session consultations', () => {
    expect(computeMeanConsultationDurationMinutes([8, 10], 15, 10)).toBe(15);
    expect(computeMeanConsultationDurationMinutes([], 15, 10)).toBe(15);
  });

  it('falls back to the slot length when neither is available (EC-14)', () => {
    expect(computeMeanConsultationDurationMinutes([], null, 10)).toBe(10);
  });

  it('never returns less than the slot length', () => {
    expect(computeMeanConsultationDurationMinutes([2, 3, 4], null, 10)).toBe(10);
    expect(computeMeanConsultationDurationMinutes([], 5, 10)).toBe(10);
  });
});

describe('estimateForPosition — FR-APT-20/21', () => {
  it('adds one mean-duration slot per patient ahead', () => {
    const now = new Date('2026-08-10T10:00:00Z');
    expect(estimateForPosition(now, 0, 10).getTime()).toBe(now.getTime());
    expect(estimateForPosition(now, 3, 10).getTime()).toBe(now.getTime() + 30 * 60 * 1000);
  });
});

describe('hasEstimateSlipped / shouldNotifySlip — BR-20, FR-APT-24', () => {
  const bookedAt = new Date('2026-08-10T10:00:00Z');

  it('has not slipped within the threshold, has slipped beyond it', () => {
    expect(hasEstimateSlipped(bookedAt, new Date('2026-08-10T10:30:00Z'), 30)).toBe(false);
    expect(hasEstimateSlipped(bookedAt, new Date('2026-08-10T10:31:00Z'), 30)).toBe(true);
  });

  it('notifies once on first crossing the threshold', () => {
    expect(shouldNotifySlip(bookedAt, new Date('2026-08-10T10:31:00Z'), null, 30)).toBe(true);
  });

  it('does not re-notify once a notification has already been recorded', () => {
    expect(shouldNotifySlip(bookedAt, new Date('2026-08-10T11:30:00Z'), new Date('2026-08-10T10:31:00Z'), 30)).toBe(false);
  });

  it('does not notify below the threshold', () => {
    expect(shouldNotifySlip(bookedAt, new Date('2026-08-10T10:15:00Z'), null, 30)).toBe(false);
  });
});
