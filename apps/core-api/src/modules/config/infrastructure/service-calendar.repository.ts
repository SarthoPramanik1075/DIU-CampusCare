import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../../infrastructure/database/client.js';
import type {
  ConflictingSession,
  CreateServiceCalendarOutcome,
  DeleteServiceCalendarOutcome,
  ServiceCalendarRepository,
  UpdateServiceCalendarOutcome,
} from '../application/service-calendar-repository.js';
import type { ServiceCalendarEntry } from '../domain/service-calendar.js';

/** Postgres `unique_violation` — the race this insert can hit is `uq_service_calendar_date`. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === PG_UNIQUE_VIOLATION;
}

/** Sessions that still occupy a place on the schedule — mirrors the same set `KyselyDoctorRepository` uses for its own upcoming-session count. */
const UPCOMING_SESSION_STATUSES = ['scheduled', 'started', 'interrupted'] as const;

interface EntryRow {
  id: string;
  location_id: string;
  calendar_date: string;
  is_service_day: boolean;
  reason: string;
  created_by: string;
  created_by_name: string;
  created_at: Date;
  version: number;
}

function toEntry(row: EntryRow): ServiceCalendarEntry {
  return {
    id: row.id,
    locationId: row.location_id,
    calendarDate: row.calendar_date,
    isServiceDay: row.is_service_day,
    reason: row.reason,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    version: row.version,
  };
}

export class KyselyServiceCalendarRepository implements ServiceCalendarRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private baseSelect() {
    return this.db
      .selectFrom('config.service_calendar')
      .innerJoin('identity.user_account', 'identity.user_account.id', 'config.service_calendar.created_by')
      .select([
        'config.service_calendar.id as id',
        'config.service_calendar.location_id as location_id',
        'config.service_calendar.calendar_date as calendar_date',
        'config.service_calendar.is_service_day as is_service_day',
        'config.service_calendar.reason as reason',
        'config.service_calendar.created_by as created_by',
        'identity.user_account.full_name as created_by_name',
        'config.service_calendar.created_at as created_at',
        'config.service_calendar.version as version',
      ]);
  }

  async findDefaultLocationId(): Promise<string> {
    const row = await this.db.selectFrom('config.location').select('id').orderBy('created_at', 'asc').executeTakeFirst();
    if (row === undefined) {
      throw new Error('config.location has no rows — has 008_scheduling_extensions.sql been migrated?');
    }
    return row.id;
  }

  async listEntries(locationId: string, from: string, to: string): Promise<readonly ServiceCalendarEntry[]> {
    const rows = await this.baseSelect()
      .where('config.service_calendar.location_id', '=', locationId)
      .where('config.service_calendar.calendar_date', '>=', from)
      .where('config.service_calendar.calendar_date', '<=', to)
      .orderBy('config.service_calendar.calendar_date')
      .execute();
    return rows.map(toEntry);
  }

  async findEntryById(id: string): Promise<ServiceCalendarEntry | null> {
    const row = await this.baseSelect().where('config.service_calendar.id', '=', id).executeTakeFirst();
    return row === undefined ? null : toEntry(row);
  }

  async createEntries(locationId: string, dates: readonly string[], isServiceDay: boolean, reason: string, createdBy: string): Promise<CreateServiceCalendarOutcome> {
    const existing = await this.db
      .selectFrom('config.service_calendar')
      .select('calendar_date')
      .where('location_id', '=', locationId)
      .where('calendar_date', 'in', [...dates])
      .executeTakeFirst();
    if (existing !== undefined) return { outcome: 'conflict', conflictingDate: existing.calendar_date };

    const rows = dates.map((date) => ({ id: uuidv7(), calendar_date: date }));
    const ids = rows.map((row) => row.id);
    try {
      await this.db
        .insertInto('config.service_calendar')
        .values(rows.map((row) => ({ id: row.id, location_id: locationId, calendar_date: row.calendar_date, is_service_day: isServiceDay, reason, created_by: createdBy })))
        .execute();
    } catch (error) {
      if (isUniqueViolation(error)) {
        const conflict = await this.db.selectFrom('config.service_calendar').select('calendar_date').where('location_id', '=', locationId).where('calendar_date', 'in', [...dates]).executeTakeFirst();
        return { outcome: 'conflict', conflictingDate: conflict?.calendar_date ?? dates[0] ?? '' };
      }
      throw error;
    }

    const items = await this.baseSelect().where('config.service_calendar.id', 'in', ids).orderBy('config.service_calendar.calendar_date').execute();
    const conflictingSessions = await this.findConflictingSessions(locationId, dates);

    return { outcome: 'created', items: items.map(toEntry), conflictingSessions };
  }

  async findConflictingSessions(locationId: string, dates: readonly string[]): Promise<readonly ConflictingSession[]> {
    const rows = await this.db
      .selectFrom('scheduling.clinic_session')
      .innerJoin('scheduling.doctor', 'scheduling.doctor.id', 'scheduling.clinic_session.doctor_id')
      .select(['scheduling.clinic_session.id as id', 'scheduling.doctor.full_name as doctor_name', 'scheduling.clinic_session.session_date as session_date'])
      .where('scheduling.clinic_session.location_id', '=', locationId)
      .where('scheduling.clinic_session.session_date', 'in', [...dates])
      .where('scheduling.clinic_session.status', 'in', UPCOMING_SESSION_STATUSES)
      .execute();
    return rows.map((row) => ({ sessionId: row.id, doctorName: row.doctor_name, sessionDate: row.session_date }));
  }

  async updateEntry(id: string, input: { readonly isServiceDay: boolean | undefined; readonly reason: string | undefined; readonly expectedVersion: number }): Promise<UpdateServiceCalendarOutcome> {
    const row = await this.db
      .updateTable('config.service_calendar')
      .set((eb) => ({
        ...(input.isServiceDay === undefined ? {} : { is_service_day: input.isServiceDay }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        version: eb('version', '+', 1),
      }))
      .where('id', '=', id)
      .where('version', '=', input.expectedVersion)
      .returning('id')
      .executeTakeFirst();

    if (row === undefined) {
      const stillExists = await this.db.selectFrom('config.service_calendar').select('id').where('id', '=', id).executeTakeFirst();
      return stillExists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    const entry = await this.findEntryById(row.id);
    if (entry === null) throw new Error(`config.service_calendar ${row.id} vanished immediately after its own update`);
    return { outcome: 'updated', entry };
  }

  async deleteEntry(id: string): Promise<DeleteServiceCalendarOutcome> {
    const result = await this.db.deleteFrom('config.service_calendar').where('id', '=', id).executeTakeFirst();
    return result.numDeletedRows > 0n ? 'deleted' : 'not_found';
  }
}
