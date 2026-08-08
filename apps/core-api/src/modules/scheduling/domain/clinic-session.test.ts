import { describe, expect, it } from 'vitest';

import { canCancel, canComplete, canEditTimes, canInterrupt, canStart, type SessionStatus } from './clinic-session.js';

const ALL_STATUSES: readonly SessionStatus[] = ['scheduled', 'started', 'interrupted', 'completed', 'cancelled'];

describe('canStart — API §3.3', () => {
  it('permits starting a scheduled session, or resuming an interrupted one', () => {
    expect(canStart('scheduled')).toBe(true);
    expect(canStart('interrupted')).toBe(true);
  });

  it('refuses starting an already-started, completed, or cancelled session', () => {
    expect(canStart('started')).toBe(false);
    expect(canStart('completed')).toBe(false);
    expect(canStart('cancelled')).toBe(false);
  });
});

describe('canInterrupt — API §3.3, EC-04', () => {
  it('permits interrupting only a running session', () => {
    for (const status of ALL_STATUSES) {
      expect(canInterrupt(status)).toBe(status === 'started');
    }
  });
});

describe('canComplete — API §3.3, EC-04', () => {
  it('permits completing a running or interrupted session', () => {
    expect(canComplete('started')).toBe(true);
    expect(canComplete('interrupted')).toBe(true);
  });

  it('refuses completing a scheduled, already-completed, or cancelled session', () => {
    expect(canComplete('scheduled')).toBe(false);
    expect(canComplete('completed')).toBe(false);
    expect(canComplete('cancelled')).toBe(false);
  });
});

describe('canCancel — API §3.3', () => {
  it('permits cancelling any non-terminal session', () => {
    expect(canCancel('scheduled')).toBe(true);
    expect(canCancel('started')).toBe(true);
    expect(canCancel('interrupted')).toBe(true);
  });

  it('refuses cancelling an already-terminal session', () => {
    expect(canCancel('completed')).toBe(false);
    expect(canCancel('cancelled')).toBe(false);
  });
});

describe('canEditTimes — API §3.3 SESSION_ALREADY_STARTED', () => {
  it('permits editing times only while scheduled', () => {
    for (const status of ALL_STATUSES) {
      expect(canEditTimes(status)).toBe(status === 'scheduled');
    }
  });
});
