import { describe, expect, it } from 'vitest';

import { bstTimeOfDay, bstWeekday, toBstIsoString } from './bst-datetime.js';

describe('toBstIsoString', () => {
  it('renders a UTC instant in Bangladesh Standard Time with a +06:00 suffix', () => {
    // 08:30 UTC is 14:30 in Dhaka (UTC+6).
    expect(toBstIsoString(new Date('2026-08-03T08:30:00Z'))).toBe('2026-08-03T14:30:00+06:00');
  });

  it('rolls the calendar date forward across midnight UTC', () => {
    // 19:00 UTC on the 3rd is 01:00 on the 4th in Dhaka.
    expect(toBstIsoString(new Date('2026-08-03T19:00:00Z'))).toBe('2026-08-04T01:00:00+06:00');
  });

  it('renders midnight in Dhaka as 00:00, never 24:00', () => {
    // 18:00 UTC is exactly 00:00 the next day in Dhaka.
    expect(toBstIsoString(new Date('2026-08-03T18:00:00Z'))).toBe('2026-08-04T00:00:00+06:00');
  });

  it('zero-pads single-digit month, day, hour, minute and second', () => {
    // 00:05 UTC on 2026-01-02 is 06:05 in Dhaka the same day.
    expect(toBstIsoString(new Date('2026-01-02T00:05:09Z'))).toBe('2026-01-02T06:05:09+06:00');
  });
});

describe('bstWeekday', () => {
  it('matches Postgres EXTRACT(DOW ...) — 0 for Sunday', () => {
    // 2026-08-02 is a Sunday in Dhaka.
    expect(bstWeekday(new Date('2026-08-02T08:00:00Z'))).toBe(0);
  });

  it('rolls the weekday forward across midnight UTC into Dhaka the next day', () => {
    // 19:00 UTC on Sunday 2026-08-02 is 01:00 Monday in Dhaka.
    expect(bstWeekday(new Date('2026-08-02T19:00:00Z'))).toBe(1);
  });

  it('returns 6 for Saturday', () => {
    // 2026-08-08 is a Saturday in Dhaka.
    expect(bstWeekday(new Date('2026-08-08T08:00:00Z'))).toBe(6);
  });
});

describe('bstTimeOfDay', () => {
  it('renders the Dhaka wall-clock time as HH:mm:ss', () => {
    expect(bstTimeOfDay(new Date('2026-08-03T08:30:15Z'))).toBe('14:30:15');
  });

  it('renders midnight in Dhaka as 00:00:00, never 24:00:00', () => {
    expect(bstTimeOfDay(new Date('2026-08-03T18:00:00Z'))).toBe('00:00:00');
  });
});
