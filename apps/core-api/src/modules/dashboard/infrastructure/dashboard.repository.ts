import { bstTimeOfDay, bstWeekday, toBstIsoString } from '@campuscare/shared-types';
import type { Kysely } from 'kysely';

import type { Database } from '../../../infrastructure/database/client.js';
import type { BookingSuspensionState, DashboardRepository } from '../application/dashboard-repository.js';
import { computeMedicineStoreState, type MedicineStoreState } from '../domain/medicine-store.js';

export class KyselyDashboardRepository implements DashboardRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findMedicineStoreState(now: Date): Promise<MedicineStoreState> {
    const location = await this.db.selectFrom('config.location').select('id').where('is_active', '=', true).orderBy('id').executeTakeFirst();
    if (location === undefined) {
      return computeMedicineStoreState(bstTimeOfDay(now), null, null);
    }

    const todayDate = toBstIsoString(now).slice(0, 10);
    const [hoursRow, overrideRow] = await Promise.all([
      this.db
        .selectFrom('pharmacy.store_hours')
        .select(['opens_at', 'closes_at'])
        .where('location_id', '=', location.id)
        .where('weekday', '=', bstWeekday(now))
        .executeTakeFirst(),
      this.db
        .selectFrom('pharmacy.store_status_override')
        .select('is_closed')
        .where('location_id', '=', location.id)
        .where('effective_date', '=', todayDate)
        .executeTakeFirst(),
    ]);

    return computeMedicineStoreState(
      bstTimeOfDay(now),
      hoursRow === undefined ? null : { opensAt: hoursRow.opens_at, closesAt: hoursRow.closes_at },
      overrideRow === undefined ? null : { isClosed: overrideRow.is_closed },
    );
  }

  async findActiveBookingSuspension(studentId: string, now: Date): Promise<BookingSuspensionState | null> {
    const row = await this.db
      .selectFrom('identity.booking_suspension')
      .select(['suspended_until', 'no_show_count'])
      .where('student_id', '=', studentId)
      .where('lifted_at', 'is', null)
      .where('suspended_until', '>', now)
      .executeTakeFirst();
    if (row === undefined) return null;

    return {
      suspendedUntil: row.suspended_until,
      // DATABASE §8's identity.booking_suspension has no free-text reason
      // column for the suspension itself (only `lift_reason`, for lifting
      // it early) — derived from `no_show_count` rather than fabricated.
      reason: `Missed ${String(row.no_show_count)} appointment${row.no_show_count === 1 ? '' : 's'} without notice.`,
      walkInRemainsAvailable: true,
    };
  }

  async countUnreadNotifications(recipientId: string): Promise<number> {
    // `count(*)` is `bigint` in Postgres, which `node-postgres` returns as a
    // `string` (a JS `number` cannot represent every bigint value) — typing
    // this `<number>` here would be a lie about what the driver actually
    // hands back, not just a redundant annotation.
    const row = await this.db
      .selectFrom('notification.notification')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('recipient_id', '=', recipientId)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }
}
