import { describe, expect, it } from 'vitest';

import { isActive, type Announcement } from './announcement.js';

function announcement(startsAt: string, endsAt: string): Announcement {
  return { id: 'a1', body: 'Closed for training.', startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
}

describe('isActive', () => {
  it('is true when now falls strictly between the start and end', () => {
    const a = announcement('2026-08-01T00:00:00Z', '2026-08-12T23:59:00Z');
    expect(isActive(a, new Date('2026-08-05T00:00:00Z'))).toBe(true);
  });

  it('is true at the exact start and end instants — the window is inclusive', () => {
    const a = announcement('2026-08-01T00:00:00Z', '2026-08-12T23:59:00Z');
    expect(isActive(a, new Date('2026-08-01T00:00:00Z'))).toBe(true);
    expect(isActive(a, new Date('2026-08-12T23:59:00Z'))).toBe(true);
  });

  it('is false before the window starts', () => {
    const a = announcement('2026-08-01T00:00:00Z', '2026-08-12T23:59:00Z');
    expect(isActive(a, new Date('2026-07-31T23:59:59Z'))).toBe(false);
  });

  it('is false after the window ends', () => {
    const a = announcement('2026-08-01T00:00:00Z', '2026-08-12T23:59:00Z');
    expect(isActive(a, new Date('2026-08-13T00:00:00Z'))).toBe(false);
  });
});
