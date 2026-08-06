import { describe, expect, it } from 'vitest';

import { SystemClock } from './clock.js';

describe('SystemClock', () => {
  it('returns the current time on each call', () => {
    const clock = new SystemClock();
    const before = Date.now();
    const observed = clock.now().getTime();
    const after = Date.now();
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });

  it('returns a fresh Date each call, not a cached instance', () => {
    const clock = new SystemClock();
    expect(clock.now()).not.toBe(clock.now());
  });
});
