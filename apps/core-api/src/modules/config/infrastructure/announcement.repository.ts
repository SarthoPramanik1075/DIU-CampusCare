import type { Kysely } from 'kysely';

import type { Database } from '../../../infrastructure/database/client.js';
import type { AnnouncementRepository } from '../application/announcement-repository.js';
import type { Announcement } from '../domain/announcement.js';

/**
 * The infrastructure adapter for {@link AnnouncementRepository}. Constructed
 * once at the composition root (DR-5) and injected wherever the port is
 * needed — nothing in `application/` or `domain/` imports this file.
 */
export class KyselyAnnouncementRepository implements AnnouncementRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findAll(): Promise<readonly Announcement[]> {
    const rows = await this.db
      .selectFrom('config.announcement')
      .select(['id', 'body', 'starts_at', 'ends_at'])
      .execute();

    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    }));
  }
}
