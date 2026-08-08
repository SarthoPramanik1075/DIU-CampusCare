import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../../infrastructure/database/client.js';
import type {
  AffectedAppointmentDetail,
  AlternativeAvailabilityEntry,
  CreateUnavailabilityOutcome,
  DeleteUnavailabilityOutcome,
  ImpactAnalysis,
  PreviewRecord,
  UnavailabilityRecord,
  UnavailabilityRepository,
} from '../application/unavailability-repository.js';

/** "Open" — not yet completed and not already in a terminal state; what a leave period would actually cancel. */
const OPEN_APPOINTMENT_STATUSES = ['booked', 'checked_in', 'waiting', 'in_consultation'] as const;

/** Occupies a place in the session's capacity, for computing remaining alternative availability. */
const ACTIVE_APPOINTMENT_STATUSES = ['booked', 'checked_in', 'waiting', 'in_consultation', 'completed'] as const;

const UPCOMING_SESSION_STATUSES = ['scheduled', 'started', 'interrupted'] as const;

interface UnavailabilityRow {
  id: string;
  doctor_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  created_by: string;
  created_at: Date;
}

function toUnavailabilityRecord(row: UnavailabilityRow): UnavailabilityRecord {
  return { unavailabilityId: row.id, doctorId: row.doctor_id, startDate: row.start_date, endDate: row.end_date, reason: row.reason, createdBy: row.created_by, createdAt: row.created_at };
}

export class KyselyUnavailabilityRepository implements UnavailabilityRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async doctorExists(doctorId: string): Promise<boolean> {
    const row = await this.db.selectFrom('scheduling.doctor').select('id').where('id', '=', doctorId).executeTakeFirst();
    return row !== undefined;
  }

  /** `period` is a `daterange` — read back via `lower`/`upper` rather than Kysely's typed builder, which has no native range support. `upper()` is exclusive on the canonical `[)` form, so the stored end date is `upper() - 1`. */
  async findOverlappingUnavailability(doctorId: string, startDate: string, endDate: string): Promise<UnavailabilityRecord | null> {
    const result = await sql<UnavailabilityRow>`
      SELECT id, doctor_id, lower(period)::text AS start_date, (upper(period) - 1)::text AS end_date, reason, created_by, created_at
      FROM scheduling.doctor_unavailability
      WHERE doctor_id = ${doctorId}
        AND period && daterange(${startDate}::date, ${endDate}::date, '[]')
      LIMIT 1
    `.execute(this.db);
    const row = result.rows[0];
    return row === undefined ? null : toUnavailabilityRecord(row);
  }

  async computeImpact(doctorId: string, startDate: string, endDate: string): Promise<ImpactAnalysis> {
    const sessions = await this.db
      .selectFrom('scheduling.clinic_session')
      .select(['id', 'session_date'])
      .where('doctor_id', '=', doctorId)
      .where('session_date', '>=', startDate)
      .where('session_date', '<=', endDate)
      .where('status', 'in', UPCOMING_SESSION_STATUSES)
      .execute();

    if (sessions.length === 0) {
      return { affectedSessions: 0, affectedAppointments: [], alternativeAvailability: [] };
    }

    const sessionIds = sessions.map((session) => session.id);

    const appointmentRows = await this.db
      .selectFrom('queueing.appointment')
      .innerJoin('scheduling.clinic_session', 'scheduling.clinic_session.id', 'queueing.appointment.clinic_session_id')
      .leftJoin('identity.student_profile', 'identity.student_profile.user_account_id', 'queueing.appointment.student_id')
      .leftJoin('identity.user_account', 'identity.user_account.id', 'queueing.appointment.student_id')
      .select([
        'queueing.appointment.id as id',
        'queueing.appointment.appointment_ref as appointment_ref',
        'queueing.appointment.student_id as student_id',
        'identity.student_profile.student_ref as student_ref',
        'identity.user_account.full_name as student_name',
        'scheduling.clinic_session.session_date as session_date',
        'queueing.appointment.serial_number as serial_number',
        'queueing.appointment.payment_status as payment_status',
      ])
      .where('queueing.appointment.clinic_session_id', 'in', sessionIds)
      .where('queueing.appointment.status', 'in', OPEN_APPOINTMENT_STATUSES)
      .execute();

    const affectedAppointments: AffectedAppointmentDetail[] = appointmentRows.map((row) => ({
      appointmentId: row.id,
      appointmentRef: row.appointment_ref,
      studentId: row.student_id,
      studentRef: row.student_ref,
      studentName: row.student_name,
      sessionDate: row.session_date,
      serialNumber: row.serial_number,
      paymentStatus: row.payment_status,
      requiresRefundFlag: row.payment_status !== 'unpaid',
    }));

    const alternativeAvailability = await this.findAlternativeAvailability(doctorId, [...new Set(sessions.map((session) => session.session_date))]);

    return { affectedSessions: sessions.length, affectedAppointments, alternativeAvailability };
  }

  /** BR-27 — same-day sessions with a different doctor that still have bookable capacity remaining. */
  private async findAlternativeAvailability(excludeDoctorId: string, sessionDates: readonly string[]): Promise<readonly AlternativeAvailabilityEntry[]> {
    const alternatives: AlternativeAvailabilityEntry[] = [];
    for (const sessionDate of sessionDates) {
      const otherSessions = await this.db
        .selectFrom('scheduling.clinic_session')
        .innerJoin('scheduling.doctor', 'scheduling.doctor.id', 'scheduling.clinic_session.doctor_id')
        .select(['scheduling.clinic_session.id as id', 'scheduling.doctor.full_name as doctor_name', 'scheduling.clinic_session.bookable_slot_count as bookable_slot_count'])
        .where('scheduling.clinic_session.doctor_id', '!=', excludeDoctorId)
        .where('scheduling.clinic_session.session_date', '=', sessionDate)
        .where('scheduling.clinic_session.status', 'in', UPCOMING_SESSION_STATUSES)
        .execute();

      for (const session of otherSessions) {
        const bookedRow = await this.db
          .selectFrom('queueing.appointment')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where('clinic_session_id', '=', session.id)
          .where('status', 'in', ACTIVE_APPOINTMENT_STATUSES)
          .executeTakeFirst();
        const remainingSlots = session.bookable_slot_count - Number(bookedRow?.count ?? '0');
        if (remainingSlots > 0) {
          alternatives.push({ doctorName: session.doctor_name, sessionDate, remainingSlots });
        }
      }
    }
    return alternatives;
  }

  async createPreview(doctorId: string, startDate: string, endDate: string, reason: string, affectedAppointmentIds: readonly string[], expiresAt: Date): Promise<{ readonly previewToken: string }> {
    const id = uuidv7();
    await this.db
      .insertInto('scheduling.unavailability_preview')
      .values({
        id,
        doctor_id: doctorId,
        start_date: startDate,
        end_date: endDate,
        reason,
        affected_appointment_ids: [...affectedAppointmentIds],
        expires_at: expiresAt,
      })
      .execute();
    return { previewToken: id };
  }

  async findPreview(previewToken: string, doctorId: string): Promise<PreviewRecord | null> {
    const row = await this.db
      .selectFrom('scheduling.unavailability_preview')
      .selectAll()
      .where('id', '=', previewToken)
      .where('doctor_id', '=', doctorId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (row === undefined) return null;
    return {
      previewToken: row.id,
      doctorId: row.doctor_id,
      startDate: row.start_date,
      endDate: row.end_date,
      reason: row.reason,
      affectedAppointmentIds: row.affected_appointment_ids,
      expiresAt: row.expires_at,
    };
  }

  async createUnavailability(
    doctorId: string,
    startDate: string,
    endDate: string,
    reason: string,
    affectedAppointmentIds: readonly string[],
    createdBy: string,
  ): Promise<CreateUnavailabilityOutcome> {
    const conflict = await this.findOverlappingUnavailability(doctorId, startDate, endDate);
    if (conflict !== null) return { outcome: 'overlap', conflicting: conflict };

    const id = uuidv7();
    const cancelledAppointmentIds = await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('scheduling.doctor_unavailability')
        .values({
          id,
          doctor_id: doctorId,
          period: sql`daterange(${startDate}::date, ${endDate}::date, '[]')`,
          reason,
          created_by: createdBy,
        })
        .execute();

      if (affectedAppointmentIds.length === 0) return [];

      const cancelled = await trx
        .updateTable('queueing.appointment')
        .set({ status: 'cancelled', cancelled_at: new Date(), cancellation_reason: 'Doctor Unavailable' })
        .where('id', 'in', [...affectedAppointmentIds])
        .where('status', 'in', OPEN_APPOINTMENT_STATUSES)
        .returning('id')
        .execute();
      return cancelled.map((row) => row.id);
    });

    return { outcome: 'created', unavailabilityId: id, cancelledAppointmentIds };
  }

  async listUnavailability(doctorId: string, from: string, to: string): Promise<readonly UnavailabilityRecord[]> {
    const result = await sql<UnavailabilityRow>`
      SELECT id, doctor_id, lower(period)::text AS start_date, (upper(period) - 1)::text AS end_date, reason, created_by, created_at
      FROM scheduling.doctor_unavailability
      WHERE doctor_id = ${doctorId}
        AND period && daterange(${from}::date, ${to}::date, '[]')
      ORDER BY lower(period)
    `.execute(this.db);
    return result.rows.map(toUnavailabilityRecord);
  }

  async findUnavailabilityById(unavailabilityId: string): Promise<UnavailabilityRecord | null> {
    const result = await sql<UnavailabilityRow>`
      SELECT id, doctor_id, lower(period)::text AS start_date, (upper(period) - 1)::text AS end_date, reason, created_by, created_at
      FROM scheduling.doctor_unavailability
      WHERE id = ${unavailabilityId}
    `.execute(this.db);
    const row = result.rows[0];
    return row === undefined ? null : toUnavailabilityRecord(row);
  }

  async deleteUnavailability(unavailabilityId: string): Promise<DeleteUnavailabilityOutcome> {
    const result = await this.db.deleteFrom('scheduling.doctor_unavailability').where('id', '=', unavailabilityId).executeTakeFirst();
    return result.numDeletedRows > 0n ? 'deleted' : 'not_found';
  }
}
