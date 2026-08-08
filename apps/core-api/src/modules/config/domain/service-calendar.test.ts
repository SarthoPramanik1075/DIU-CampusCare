import { describe, expect, it } from 'vitest';

import { enumerateDates, isNonEmptyReason, isValidDateOrder, rangeDaysInclusive } from './service-calendar.js';

describe('isNonEmptyReason', () => {
  it('rejects empty or whitespace-only text', () => {
    expect(isNonEmptyReason('')).toBe(false);
    expect(isNonEmptyReason('   ')).toBe(false);
  });

  it('accepts any non-empty text, no minimum length', () => {
    expect(isNonEmptyReason('x')).toBe(true);
  });
});

describe('isValidDateOrder', () => {
  it('rejects toDate before fromDate', () => {
    expect(isValidDateOrder('2026-08-15', '2026-08-14')).toBe(false);
  });

  it('accepts toDate on or after fromDate', () => {
    expect(isValidDateOrder('2026-08-15', '2026-08-15')).toBe(true);
    expect(isValidDateOrder('2026-08-15', '2026-08-16')).toBe(true);
  });
});

describe('rangeDaysInclusive', () => {
  it('counts a single day as 1', () => {
    expect(rangeDaysInclusive('2026-08-15', '2026-08-15')).toBe(1);
  });

  it('counts inclusively', () => {
    expect(rangeDaysInclusive('2026-08-15', '2026-08-16')).toBe(2);
    expect(rangeDaysInclusive('2026-01-01', '2026-12-31')).toBe(365);
  });
});

describe('enumerateDates', () => {
  it('returns a single date for a same-day range', () => {
    expect(enumerateDates('2026-08-15', '2026-08-15')).toEqual(['2026-08-15']);
  });

  it('returns one entry per date, inclusive of both ends', () => {
    expect(enumerateDates('2026-08-15', '2026-08-17')).toEqual(['2026-08-15', '2026-08-16', '2026-08-17']);
  });
});
