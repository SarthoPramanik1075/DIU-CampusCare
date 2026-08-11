import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../../infrastructure/database/client.js';
import type { BookingSuspensionDetail, BookingSuspensionRepository } from '../application/booking-suspension-repository.js';

export class KyselyBookingSuspensionRepository implements BookingSuspensionRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async countRecentNoShows(studentId: string, windowStart: Date): Promise<number> {
    const row = await this.db
      .selectFrom('queueing.appointment')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('student_id', '=', studentId)
      .where('status', '=', 'no_show')
      .where('no_show_marked_at', '>=', windowStart)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async createSuspension(studentId: string, suspendedUntil: Date, noShowCount: number): Promise<void> {
    await this.db
      .insertInto('identity.booking_suspension')
      .values({ id: uuidv7(), student_id: studentId, suspended_until: suspendedUntil, no_show_count: noShowCount })
      .execute();
  }

  async findActiveSuspensionDetail(studentId: string, now: Date): Promise<BookingSuspensionDetail | null> {
    const row = await this.db
      .selectFrom('identity.booking_suspension')
      .select(['suspended_until', 'no_show_count'])
      .where('student_id', '=', studentId)
      .where('lifted_at', 'is', null)
      .where('suspended_until', '>', now)
      .orderBy('suspended_until', 'desc')
      .executeTakeFirst();
    return row === undefined ? null : { suspendedUntil: row.suspended_until, noShowCount: row.no_show_count };
  }
}
