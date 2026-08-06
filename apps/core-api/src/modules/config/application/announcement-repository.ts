import type { Announcement } from '../domain/announcement.js';

/**
 * The repository port. The application layer depends on this interface,
 * never on Kysely directly (DR-6) — `infrastructure/announcement.repository.ts`
 * is the one place that changes if the persistence technology ever does.
 *
 * Returns every row, unfiltered: `isActive` is a business rule and belongs
 * in the domain layer where it is unit-tested and where it stays if a future
 * rule (a grace period, a draft state) makes "active" more than a date
 * comparison. The table this reads from is administrator-maintained and
 * small by nature, so there is no performance case for pushing the filter
 * into SQL — doing so would just relocate the rule to a place it cannot be
 * tested without a database.
 */
export interface AnnouncementRepository {
  findAll(): Promise<readonly Announcement[]>;
}
