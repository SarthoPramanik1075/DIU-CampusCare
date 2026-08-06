/**
 * Server-time only — EC-54.
 *
 * "All time-sensitive decisions (cutoffs, grace periods, expiry) are
 * evaluated server-side against server time only." Every kernel and domain
 * component that makes a time-sensitive decision takes a `Clock` by
 * constructor injection rather than calling `new Date()` or `Date.now()`
 * directly — that is what makes those decisions replaceable with a fixed
 * instant in a test, and what makes it impossible for a client-supplied
 * timestamp to influence one by accident.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
