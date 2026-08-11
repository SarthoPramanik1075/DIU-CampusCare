import { describe, expect, it } from 'vitest';

import {
  classifyCancellation,
  hasGracePeriodElapsed,
  isBeforeBookingCutoff,
  isBelowMaxActiveBookings,
  isSlotInFuture,
  isUnderActiveSuspension,
  isValidVisitReasonNote,
  isWithinPublicationWindow,
  remainingGracePeriodSeconds,
} from './booking-validation.js';

const NOW = new Date('2026-08-10T10:00:00Z');

describe('isSlotInFuture — VR-20', () => {
  it('accepts a slot after now, rejects one at or before now', () => {
    expect(isSlotInFuture(new Date('2026-08-10T10:00:01Z'), NOW)).toBe(true);
    expect(isSlotInFuture(NOW, NOW)).toBe(false);
    expect(isSlotInFuture(new Date('2026-08-10T09:59:00Z'), NOW)).toBe(false);
  });
});

describe('isWithinPublicationWindow — VR-20, OI-07', () => {
  it('accepts today and the last day of the window, rejects the day after', () => {
    expect(isWithinPublicationWindow('2026-08-10', '2026-08-10', 7)).toBe(true);
    expect(isWithinPublicationWindow('2026-08-17', '2026-08-10', 7)).toBe(true);
    expect(isWithinPublicationWindow('2026-08-18', '2026-08-10', 7)).toBe(false);
  });

  it('rejects a date before today', () => {
    expect(isWithinPublicationWindow('2026-08-09', '2026-08-10', 7)).toBe(false);
  });
});

describe('isBeforeBookingCutoff — VR-24, FR-APT-11', () => {
  it('accepts before the cutoff, rejects at or after it', () => {
    const sessionStartsAt = new Date('2026-08-10T13:00:00Z');
    expect(isBeforeBookingCutoff(sessionStartsAt, 60, new Date('2026-08-10T11:59:00Z'))).toBe(true);
    expect(isBeforeBookingCutoff(sessionStartsAt, 60, new Date('2026-08-10T12:00:00Z'))).toBe(false);
    expect(isBeforeBookingCutoff(sessionStartsAt, 60, new Date('2026-08-10T12:30:00Z'))).toBe(false);
  });
});

describe('isBelowMaxActiveBookings — VR-21, BR-11', () => {
  it('accepts below the max, rejects at or above it', () => {
    expect(isBelowMaxActiveBookings(1, 2)).toBe(true);
    expect(isBelowMaxActiveBookings(2, 2)).toBe(false);
    expect(isBelowMaxActiveBookings(3, 2)).toBe(false);
  });
});

describe('isUnderActiveSuspension — VR-23, FR-APT-12', () => {
  it('is false when there is no suspension', () => {
    expect(isUnderActiveSuspension(null, NOW)).toBe(false);
  });

  it('is true while suspended_until is in the future, false once it has passed', () => {
    expect(isUnderActiveSuspension(new Date('2026-08-11T00:00:00Z'), NOW)).toBe(true);
    expect(isUnderActiveSuspension(new Date('2026-08-09T00:00:00Z'), NOW)).toBe(false);
  });
});

describe('isValidVisitReasonNote — VR-25', () => {
  it('accepts null and a note within 200 characters', () => {
    expect(isValidVisitReasonNote(null)).toBe(true);
    expect(isValidVisitReasonNote('a'.repeat(200))).toBe(true);
  });

  it('rejects a note over 200 characters', () => {
    expect(isValidVisitReasonNote('a'.repeat(201))).toBe(false);
  });
});

describe('classifyCancellation — BR-12, FR-APT-16', () => {
  it('classifies as cancelled when at least the cutoff away, late_cancellation otherwise', () => {
    const estimatedAt = new Date('2026-08-10T13:00:00Z');
    expect(classifyCancellation(estimatedAt, 120, new Date('2026-08-10T10:59:00Z'))).toBe('cancelled');
    expect(classifyCancellation(estimatedAt, 120, new Date('2026-08-10T11:00:00Z'))).toBe('late_cancellation');
    expect(classifyCancellation(estimatedAt, 120, new Date('2026-08-10T12:59:00Z'))).toBe('late_cancellation');
  });
});

describe('hasGracePeriodElapsed / remainingGracePeriodSeconds — VR-31, BR-14', () => {
  it('has not elapsed before the grace period, has elapsed at or after it', () => {
    const calledAt = new Date('2026-08-10T10:00:00Z');
    expect(hasGracePeriodElapsed(calledAt, 20, new Date('2026-08-10T10:19:00Z'))).toBe(false);
    expect(hasGracePeriodElapsed(calledAt, 20, new Date('2026-08-10T10:20:00Z'))).toBe(true);
  });

  it('reports the remaining seconds, floored at zero once elapsed', () => {
    const calledAt = new Date('2026-08-10T10:00:00Z');
    expect(remainingGracePeriodSeconds(calledAt, 20, new Date('2026-08-10T10:15:00Z'))).toBe(300);
    expect(remainingGracePeriodSeconds(calledAt, 20, new Date('2026-08-10T10:25:00Z'))).toBe(0);
  });
});
