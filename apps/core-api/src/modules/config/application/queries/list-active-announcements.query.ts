import type { Clock } from '../../../../kernel/clock/clock.js';
import { isActive, type Announcement } from '../../domain/announcement.js';
import type { AnnouncementRepository } from '../announcement-repository.js';

/**
 * API §2.5 `GET /api/v1/public/announcements`. A query, not a command: it
 * changes nothing and so emits no audit entry (DR-7 applies to
 * state-changing handlers).
 *
 * Living under `application/queries/`, not directly in `application/`, is
 * what makes DR-7's coverage check mechanical rather than a judgement call:
 * `tests/architecture/command-audit-coverage.test.ts` treats every
 * `application/*.handler.ts` file as a command required to reference
 * `AuditRecorder`, and everything under `application/queries/` as exempt by
 * construction — matching the convention ARCHITECTURE §6.3 shows for
 * counseling-api's own `queries/with-access-logging.ts`.
 *
 * `Clock` is injected rather than read from `new Date()` directly — EC-54 —
 * so "what counts as active right now" is deterministic in a test.
 */
export class ListActiveAnnouncementsHandler {
  constructor(
    private readonly repository: AnnouncementRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<readonly Announcement[]> {
    const all = await this.repository.findAll();
    const now = this.clock.now();
    return all.filter((announcement) => isActive(announcement, now));
  }
}
