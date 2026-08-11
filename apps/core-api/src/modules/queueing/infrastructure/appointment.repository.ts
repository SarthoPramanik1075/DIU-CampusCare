import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../../infrastructure/database/client.js';
import {
  ACTIVE_BOOKING_STATUSES,
  type ActiveSuspension,
  type AppointmentRepository,
  type AvailableSlotItem,
  type CreateBookingInput,
  type CreateBookingOutcome,
  type ServiceCalendarClosure,
  type SlotBookingContext,
} from '../application/appointment-repository.js';
import { formatAppointmentRef } from '../domain/appointment-ref.js';


/** Postgres `unique_violation` — the race this insert can hit is `uq_appointment_slot_active` (EC-01). */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === PG_UNIQUE_VIOLATION;
}

export class KyselyAppointmentRepository implements AppointmentRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findSlotBookingContext(sessionSlotId: string): Promise<SlotBookingContext | null> {
    const row = await this.db
      .selectFrom('scheduling.session_slot')
      .innerJoin('scheduling.clinic_session', 'scheduling.clinic_session.id', 'scheduling.session_slot.clinic_session_id')
      .innerJoin('scheduling.doctor', 'scheduling.doctor.id', 'scheduling.clinic_session.doctor_id')
      .select([
        'scheduling.session_slot.id as slot_id',
        'scheduling.session_slot.slot_starts_at',
        'scheduling.session_slot.is_online_bookable',
        'scheduling.clinic_session.id as session_id',
        'scheduling.clinic_session.location_id',
        'scheduling.clinic_session.session_date',
        'scheduling.clinic_session.starts_at as session_starts_at',
        'scheduling.doctor.id as doctor_id',
        'scheduling.doctor.full_name as doctor_name',
      ])
      .where('scheduling.session_slot.id', '=', sessionSlotId)
      .executeTakeFirst();

    if (row === undefined) return null;
    return {
      slotId: row.slot_id,
      sessionId: row.session_id,
      doctorId: row.doctor_id,
      doctorName: row.doctor_name,
      locationId: row.location_id,
      sessionDate: row.session_date,
      slotStartsAt: row.slot_starts_at,
      sessionStartsAt: row.session_starts_at,
      isOnlineBookable: row.is_online_bookable,
    };
  }

  async listAvailableSlots(sessionId: string): Promise<readonly AvailableSlotItem[]> {
    const [slotRows, claimedRows] = await Promise.all([
      this.db
        .selectFrom('scheduling.session_slot')
        .select(['id', 'slot_starts_at'])
        .where('clinic_session_id', '=', sessionId)
        .where('is_online_bookable', '=', true)
        .orderBy('slot_index')
        .execute(),
      this.db
        .selectFrom('queueing.appointment')
        .select('session_slot_id')
        .where('clinic_session_id', '=', sessionId)
        .where('session_slot_id', 'is not', null)
        .where('status', 'in', ['booked', 'checked_in', 'waiting', 'in_consultation', 'completed'])
        .execute(),
    ]);
    const claimed = new Set(claimedRows.map((row) => row.session_slot_id));
    return slotRows.filter((row) => !claimed.has(row.id)).map((row) => ({ slotId: row.id, slotStartsAt: row.slot_starts_at }));
  }

  async findServiceCalendarClosure(locationId: string, sessionDate: string): Promise<ServiceCalendarClosure | null> {
    const row = await this.db
      .selectFrom('config.service_calendar')
      .select('reason')
      .where('location_id', '=', locationId)
      .where('calendar_date', '=', sessionDate)
      .where('is_service_day', '=', false)
      .executeTakeFirst();
    return row === undefined ? null : { reason: row.reason };
  }

  async countActiveBookings(studentId: string): Promise<number> {
    const row = await this.db
      .selectFrom('queueing.appointment')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('student_id', '=', studentId)
      .where('origin', '=', 'booked')
      .where('status', 'in', ACTIVE_BOOKING_STATUSES)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async hasActiveBookingWithDoctorOnDate(studentId: string, doctorId: string, sessionDate: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('queueing.appointment')
      .innerJoin('scheduling.clinic_session', 'scheduling.clinic_session.id', 'queueing.appointment.clinic_session_id')
      .select('queueing.appointment.id')
      .where('queueing.appointment.student_id', '=', studentId)
      .where('scheduling.clinic_session.doctor_id', '=', doctorId)
      .where('scheduling.clinic_session.session_date', '=', sessionDate)
      .where('queueing.appointment.origin', '=', 'booked')
      .where('queueing.appointment.status', 'in', ACTIVE_BOOKING_STATUSES)
      .executeTakeFirst();
    return row !== undefined;
  }

  async listActiveBookingKeysForStudent(studentId: string): Promise<ReadonlySet<string>> {
    const rows = await this.db
      .selectFrom('queueing.appointment')
      .innerJoin('scheduling.clinic_session', 'scheduling.clinic_session.id', 'queueing.appointment.clinic_session_id')
      .select(['scheduling.clinic_session.doctor_id', 'scheduling.clinic_session.session_date'])
      .where('queueing.appointment.student_id', '=', studentId)
      .where('queueing.appointment.origin', '=', 'booked')
      .where('queueing.appointment.status', 'in', ACTIVE_BOOKING_STATUSES)
      .execute();
    return new Set(rows.map((row) => `${row.doctor_id}:${row.session_date}`));
  }

  async findActiveSuspension(studentId: string, now: Date): Promise<ActiveSuspension | null> {
    const row = await this.db
      .selectFrom('identity.booking_suspension')
      .select('suspended_until')
      .where('student_id', '=', studentId)
      .where('suspended_until', '>', now)
      .where('lifted_at', 'is', null)
      .orderBy('suspended_until', 'desc')
      .executeTakeFirst();
    return row === undefined ? null : { suspendedUntil: row.suspended_until };
  }

  async createBooking(input: CreateBookingInput): Promise<CreateBookingOutcome> {
    const id = uuidv7();
    const year = input.slot.slotStartsAt.getUTCFullYear();

    try {
      const appointment = await this.db.transaction().execute(async (trx) => {
        const refRow = await sql<{ next_ref: string }>`SELECT nextval('queueing.appointment_ref_seq') AS next_ref`.execute(trx);
        const appointmentRef = formatAppointmentRef(year, Number(refRow.rows[0]?.next_ref));

        const serialRow = await sql<{ serial: number }>`SELECT queueing.fn_next_serial(${input.slot.sessionId}::uuid) AS serial`.execute(trx);
        const serialNumber = Number(serialRow.rows[0]?.serial);

        await trx
          .insertInto('queueing.appointment')
          .values({
            id,
            appointment_ref: appointmentRef,
            clinic_session_id: input.slot.sessionId,
            session_slot_id: input.slot.slotId,
            student_id: input.studentId,
            unregistered_name: null,
            serial_number: serialNumber,
            origin: 'booked',
            visit_reason_category_id: input.visitReasonCategoryId,
            visit_reason_note: input.visitReasonNote,
            estimate_at_booking: input.slot.slotStartsAt,
            current_estimate: input.slot.slotStartsAt,
            created_by: input.createdBy,
          })
          .execute();

        return {
          appointmentId: id,
          appointmentRef,
          clinicSessionId: input.slot.sessionId,
          doctorId: input.slot.doctorId,
          doctorName: input.slot.doctorName,
          sessionDate: input.slot.sessionDate,
          serialNumber,
          status: 'booked' as const,
          estimateAtBooking: input.slot.slotStartsAt,
          paymentStatus: 'unpaid' as const,
          version: 1,
        };
      });

      return { outcome: 'created', appointment };
    } catch (error) {
      if (isUniqueViolation(error)) return { outcome: 'slot_taken' };
      throw error;
    }
  }
}
