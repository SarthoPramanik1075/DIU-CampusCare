import type { Clock } from '../../src/kernel/clock/clock.js';

/**
 * A {@link Clock} that returns a fixed, adjustable instant.
 *
 * Lives under `tests/`, not `src/kernel/`: a test double for the one
 * component every time-sensitive rule depends on has no business in the
 * production bundle.
 */
export class FixedClock implements Clock {
  private current: Date;

  constructor(initial: Date) {
    this.current = initial;
  }

  now(): Date {
    return this.current;
  }

  set(next: Date): void {
    this.current = next;
  }

  advanceMs(deltaMs: number): void {
    this.current = new Date(this.current.getTime() + deltaMs);
  }
}
