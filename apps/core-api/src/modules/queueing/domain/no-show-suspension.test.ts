import { describe, expect, it } from 'vitest';

import { computeSuspensionUntil, computeSuspensionWindowStart, shouldSuspendForNoShows } from './no-show-suspension.js';

describe('shouldSuspendForNoShows — BR-15', () => {
  it('does not suspend below the threshold', () => {
    expect(shouldSuspendForNoShows(2, 3)).toBe(false);
  });

  it('suspends at or above the threshold', () => {
    expect(shouldSuspendForNoShows(3, 3)).toBe(true);
    expect(shouldSuspendForNoShows(4, 3)).toBe(true);
  });
});

describe('computeSuspensionUntil / computeSuspensionWindowStart — BR-15', () => {
  it('adds the configured duration forward, and subtracts the window backward', () => {
    const now = new Date('2026-08-10T00:00:00Z');
    expect(computeSuspensionUntil(now, 14).toISOString()).toBe('2026-08-24T00:00:00.000Z');
    expect(computeSuspensionWindowStart(now, 30).toISOString()).toBe('2026-07-11T00:00:00.000Z');
  });
});
