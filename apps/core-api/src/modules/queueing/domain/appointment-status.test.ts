import { describe, expect, it } from 'vitest';

import { canAdvanceTo, canCancel, canCheckIn, canMarkNoShow, canReverseTo, isTerminal, permittedTransitions, type AppointmentStatus } from './appointment-status.js';

const ALL_STATUSES: readonly AppointmentStatus[] = [
  'booked',
  'checked_in',
  'waiting',
  'in_consultation',
  'completed',
  'cancelled',
  'late_cancellation',
  'no_show',
  'expired',
];

describe('canCheckIn — API §4.3, VR-27', () => {
  it('permits check-in only from booked', () => {
    for (const status of ALL_STATUSES) {
      expect(canCheckIn(status)).toBe(status === 'booked');
    }
  });
});

describe('canAdvanceTo — API §4.3, VR-28', () => {
  it('permits exactly one adjacent step forward', () => {
    expect(canAdvanceTo('checked_in', 'waiting')).toBe(true);
    expect(canAdvanceTo('waiting', 'in_consultation')).toBe(true);
    expect(canAdvanceTo('in_consultation', 'completed')).toBe(true);
  });

  it('refuses a non-adjacent or backward jump', () => {
    expect(canAdvanceTo('booked', 'waiting')).toBe(false);
    expect(canAdvanceTo('checked_in', 'in_consultation')).toBe(false);
    expect(canAdvanceTo('waiting', 'checked_in')).toBe(false);
    expect(canAdvanceTo('completed', 'booked')).toBe(false);
  });

  it('refuses advancing a booked or terminal appointment at all', () => {
    expect(canAdvanceTo('booked', 'checked_in')).toBe(false);
    expect(canAdvanceTo('completed', 'completed')).toBe(false);
    expect(canAdvanceTo('cancelled', 'waiting')).toBe(false);
  });
});

describe('canMarkNoShow — API §4.3', () => {
  it('permits only from checked_in or waiting', () => {
    expect(canMarkNoShow('checked_in')).toBe(true);
    expect(canMarkNoShow('waiting')).toBe(true);
  });

  it('refuses from booked (session-expiry handles that case) and every terminal state', () => {
    expect(canMarkNoShow('booked')).toBe(false);
    expect(canMarkNoShow('in_consultation')).toBe(false);
    expect(canMarkNoShow('completed')).toBe(false);
    expect(canMarkNoShow('no_show')).toBe(false);
  });
});

describe('canCancel — VR-26, EC-17', () => {
  it('permits cancelling booked or checked_in', () => {
    expect(canCancel('booked')).toBe(true);
    expect(canCancel('checked_in')).toBe(true);
  });

  it('refuses cancelling once waiting or beyond', () => {
    expect(canCancel('waiting')).toBe(false);
    expect(canCancel('in_consultation')).toBe(false);
    expect(canCancel('completed')).toBe(false);
  });
});

describe('canReverseTo — API §4.3, VR-32', () => {
  it('permits reversing exactly one step to the state that preceded it', () => {
    expect(canReverseTo('checked_in', 'booked')).toBe(true);
    expect(canReverseTo('waiting', 'checked_in')).toBe(true);
    expect(canReverseTo('in_consultation', 'waiting')).toBe(true);
    expect(canReverseTo('completed', 'in_consultation')).toBe(true);
  });

  it('permits reversing a no-show back to checked_in or waiting (EC-08)', () => {
    expect(canReverseTo('no_show', 'checked_in')).toBe(true);
    expect(canReverseTo('no_show', 'waiting')).toBe(true);
  });

  it('refuses reversing to a non-preceding state', () => {
    expect(canReverseTo('completed', 'booked')).toBe(false);
    expect(canReverseTo('booked', 'checked_in')).toBe(false);
  });
});

describe('isTerminal', () => {
  it('identifies every terminal exception state, and completed', () => {
    for (const status of ['completed', 'cancelled', 'late_cancellation', 'no_show', 'expired'] as const) {
      expect(isTerminal(status)).toBe(true);
    }
  });

  it('identifies every main-chain state as non-terminal', () => {
    for (const status of ['booked', 'checked_in', 'waiting', 'in_consultation'] as const) {
      expect(isTerminal(status)).toBe(false);
    }
  });
});

describe('permittedTransitions — F-01, API §4.2', () => {
  it('offers exactly check-in and cancel for a booked appointment', () => {
    const transitions = permittedTransitions('booked');
    expect(transitions).toEqual({ checkIn: true, advanceTo: null, noShow: false, cancel: true, emergency: true });
  });

  it('offers advance-to-waiting, no-show and cancel for a checked-in appointment', () => {
    const transitions = permittedTransitions('checked_in');
    expect(transitions).toEqual({ checkIn: false, advanceTo: 'waiting', noShow: true, cancel: true, emergency: true });
  });

  it('offers nothing for a completed appointment', () => {
    const transitions = permittedTransitions('completed');
    expect(transitions).toEqual({ checkIn: false, advanceTo: null, noShow: false, cancel: false, emergency: false });
  });
});
