import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../../infrastructure/database/client.js';
import type {
  CreateDoctorInput,
  CreateDoctorResult,
  DeactivateDoctorOutcome,
  DeleteDoctorOutcome,
  DoctorDetail,
  DoctorListFilter,
  DoctorListItem,
  DoctorListPage,
  DoctorRepository,
  UpdateDoctorInput,
  UpdateDoctorOutcome,
} from '../application/doctor-repository.js';

/** Postgres `unique_violation` — the race this insert can hit is `doctor.user_account_id`'s UNIQUE constraint. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === PG_UNIQUE_VIOLATION;
}

/** Session statuses that still occupy a place on the schedule — "upcoming" for API §3.1's deactivate-impact count. */
const UPCOMING_SESSION_STATUSES = ['scheduled', 'started', 'interrupted'] as const;

export class KyselyDoctorRepository implements DoctorRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findDefaultLocationId(): Promise<string> {
    const row = await this.db.selectFrom('config.location').select('id').orderBy('created_at', 'asc').executeTakeFirst();
    if (row === undefined) {
      throw new Error('config.location has no rows — has 008_scheduling_extensions.sql been migrated?');
    }
    return row.id;
  }

  async listDoctors(filter: DoctorListFilter): Promise<DoctorListPage> {
    let query = this.db.selectFrom('scheduling.doctor').select(['id', 'full_name', 'designation', 'specialisation', 'photo_url', 'is_active', 'version']);

    if (filter.isActive !== undefined) {
      query = query.where('is_active', '=', filter.isActive);
    }
    if (filter.q !== undefined) {
      const pattern = `%${filter.q}%`;
      query = query.where((eb) => eb.or([eb('full_name', 'ilike', pattern), eb('specialisation', 'ilike', pattern)]));
    }
    if (filter.cursor !== undefined) {
      query = query.where('id', '>', filter.cursor);
    }

    const rows = await query.orderBy('id').limit(filter.limit + 1).execute();
    const hasMore = rows.length > filter.limit;
    const pageRows = hasMore ? rows.slice(0, filter.limit) : rows;

    const items: DoctorListItem[] = pageRows.map((row) => ({
      doctorId: row.id,
      fullName: row.full_name,
      designation: row.designation,
      specialisation: row.specialisation,
      photoUrl: row.photo_url,
      isActive: row.is_active,
      version: row.version,
    }));

    const lastRow = pageRows.at(-1);
    return { items, nextCursor: hasMore && lastRow !== undefined ? lastRow.id : null };
  }

  async findDoctorDetailById(doctorId: string): Promise<DoctorDetail | null> {
    const row = await this.db
      .selectFrom('scheduling.doctor')
      .select(['id', 'user_account_id', 'full_name', 'designation', 'specialisation', 'photo_url', 'is_active', 'version'])
      .where('id', '=', doctorId)
      .executeTakeFirst();
    if (row === undefined) return null;

    const [rosterCountRow, sessionCountRow] = await Promise.all([
      this.db
        .selectFrom('scheduling.duty_roster')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('doctor_id', '=', doctorId)
        .where('is_active', '=', true)
        .executeTakeFirst(),
      this.db
        .selectFrom('scheduling.clinic_session')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('doctor_id', '=', doctorId)
        .where('status', 'in', UPCOMING_SESSION_STATUSES)
        .executeTakeFirst(),
    ]);

    return {
      doctorId: row.id,
      userAccountId: row.user_account_id,
      fullName: row.full_name,
      designation: row.designation,
      specialisation: row.specialisation,
      photoUrl: row.photo_url,
      isActive: row.is_active,
      activeRosterCount: Number(rosterCountRow?.count ?? '0'),
      upcomingSessionCount: Number(sessionCountRow?.count ?? '0'),
      version: row.version,
    };
  }

  async isUserAccountLinked(userAccountId: string): Promise<boolean> {
    const row = await this.db.selectFrom('scheduling.doctor').select('id').where('user_account_id', '=', userAccountId).executeTakeFirst();
    return row !== undefined;
  }

  async createDoctor(input: CreateDoctorInput): Promise<CreateDoctorResult> {
    const id = uuidv7();
    try {
      await this.db
        .insertInto('scheduling.doctor')
        .values({
          id,
          user_account_id: input.userAccountId,
          full_name: input.fullName,
          designation: input.designation,
          specialisation: input.specialisation,
          photo_url: input.photoUrl,
          location_id: input.locationId,
        })
        .execute();
    } catch (error) {
      if (isUniqueViolation(error)) return { outcome: 'account_already_linked' };
      throw error;
    }

    const doctor = await this.findDoctorDetailById(id);
    if (doctor === null) throw new Error(`scheduling.doctor ${id} vanished immediately after its own creation`);
    return { outcome: 'created', doctor };
  }

  async updateDoctor(input: UpdateDoctorInput): Promise<UpdateDoctorOutcome> {
    const row = await this.db
      .updateTable('scheduling.doctor')
      .set((eb) => ({
        ...(input.fullName === undefined ? {} : { full_name: input.fullName }),
        ...(input.designation === undefined ? {} : { designation: input.designation }),
        ...(input.specialisation === undefined ? {} : { specialisation: input.specialisation }),
        ...(input.photoUrl === undefined ? {} : { photo_url: input.photoUrl }),
        version: eb('version', '+', 1),
        updated_at: new Date(),
      }))
      .where('id', '=', input.doctorId)
      .where('version', '=', input.expectedVersion)
      .returning('id')
      .executeTakeFirst();

    if (row === undefined) {
      const exists = await this.db.selectFrom('scheduling.doctor').select('id').where('id', '=', input.doctorId).executeTakeFirst();
      return exists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    const doctor = await this.findDoctorDetailById(row.id);
    if (doctor === null) throw new Error(`scheduling.doctor ${row.id} vanished immediately after its own update`);
    return { outcome: 'updated', doctor };
  }

  async deactivateDoctor(doctorId: string, expectedVersion: number): Promise<DeactivateDoctorOutcome> {
    const row = await this.db
      .updateTable('scheduling.doctor')
      .set((eb) => ({ is_active: false, version: eb('version', '+', 1), updated_at: new Date() }))
      .where('id', '=', doctorId)
      .where('version', '=', expectedVersion)
      .returning('id')
      .executeTakeFirst();

    if (row === undefined) {
      const exists = await this.db.selectFrom('scheduling.doctor').select('id').where('id', '=', doctorId).executeTakeFirst();
      return exists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    const doctor = await this.findDoctorDetailById(row.id);
    if (doctor === null) throw new Error(`scheduling.doctor ${row.id} vanished immediately after its own update`);
    return { outcome: 'deactivated', doctor, affectedUpcomingSessions: doctor.upcomingSessionCount };
  }

  async countAppointmentHistory(doctorId: string): Promise<number> {
    const row = await this.db
      .selectFrom('queueing.appointment')
      .innerJoin('scheduling.clinic_session', 'scheduling.clinic_session.id', 'queueing.appointment.clinic_session_id')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('scheduling.clinic_session.doctor_id', '=', doctorId)
      .executeTakeFirst();
    return Number(row?.count ?? '0');
  }

  async deleteDoctor(doctorId: string): Promise<DeleteDoctorOutcome> {
    const result = await this.db.deleteFrom('scheduling.doctor').where('id', '=', doctorId).executeTakeFirst();
    return result.numDeletedRows > 0n ? { outcome: 'deleted' } : { outcome: 'not_found' };
  }
}
