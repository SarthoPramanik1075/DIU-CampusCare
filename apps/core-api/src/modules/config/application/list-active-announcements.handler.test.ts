import { describe, expect, it } from 'vitest';

import type { Announcement } from '../domain/announcement.js';

import type { AnnouncementRepository } from './announcement-repository.js';
import { ListActiveAnnouncementsHandler } from './list-active-announcements.handler.js';

class FixedClock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return this.instant;
  }
}

class InMemoryAnnouncementRepository implements AnnouncementRepository {
  constructor(private readonly rows: readonly Announcement[]) {}
  findAll(): Promise<readonly Announcement[]> {
    return Promise.resolve(this.rows);
  }
}

const NOW = new Date('2026-08-04T10:00:00Z');

function announcement(id: string, startsAt: string, endsAt: string): Announcement {
  return { id, body: `Announcement ${id}`, startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
}

describe('ListActiveAnnouncementsHandler', () => {
  it('returns only announcements whose window contains the current instant', async () => {
    const active = announcement('active', '2026-08-01T00:00:00Z', '2026-08-12T00:00:00Z');
    const future = announcement('future', '2026-09-01T00:00:00Z', '2026-09-12T00:00:00Z');
    const past = announcement('past', '2026-01-01T00:00:00Z', '2026-01-12T00:00:00Z');

    const handler = new ListActiveAnnouncementsHandler(
      new InMemoryAnnouncementRepository([active, future, past]),
      new FixedClock(NOW),
    );

    const result = await handler.execute();
    expect(result.map((a) => a.id)).toEqual(['active']);
  });

  it('returns an empty list when nothing is active, without error', async () => {
    const handler = new ListActiveAnnouncementsHandler(new InMemoryAnnouncementRepository([]), new FixedClock(NOW));
    await expect(handler.execute()).resolves.toEqual([]);
  });
});
