import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../../infrastructure/database/client.js';
import type {
  AffectedAppointment,
  CancelSessionOutcome,
  ClinicSessionListFilter,
  ClinicSessionListItem,
  ClinicSessionRepository,
  CompleteSessionOutcome,
  CreateClinicSessionInput,
  CreateClinicSessionResult,
  InterruptSessionOutcome,
  PublicAvailabilityDay,
  QueueSummary,
  ServiceCalendarClosure,
  SessionSlotItem,
  SessionStatus,
  StartSessionOutcome,
  UpdateClinicSessionInput,
  UpdateClinicSessionOutcome,
} from '../application/clinic-session-repository.js';
import { canCancel, canComplete, canInterrupt, canStart } from '../domain/clinic-session.js';

/** VR-19's `ex_session_no_overlap` GiST exclusion constraint — race-free by construction. */
const PG_EXCLUSION_VIOLATION = '23P01';

function isExclusionViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === PG_EXCLUSION_VIOLATION;
}

/** Occupies a place in the session's capacity — mirrors the appointment lifecycle statuses that are not a cancellation/no-show/expiry. */
const ACTIVE_APPOINTMENT_STATUSES = ['booked', 'checked_in', 'waiting', 'in_consultation', 'completed'] as const;

/** "Still open" — not yet completed and not already in a terminal (cancelled/no-show/expired) state. Used for interrupt's remaining-patients list and cancel's bulk transition. */
const OPEN_APPOINTMENT_STATUSES = ['booked', 'checked_in', 'waiting', 'in_consultation'] as const;

function toAffectedAppointment(row: { id: string; appointment_ref: string; student_id: string | null; serial_number: number }): AffectedAppointment {
  return { appointmentId: row.id, appointmentRef: row.appointment_ref, studentId: row.student_id, serialNumber: row.serial_number };
}

interface ClinicSessionJoinRow {
  id: string;
  doctor_id: string;
  doctor_full_name: string;
  location_id: string;
  session_date: string;
  starts_at: Date;
  ends_at: Date;
  slot_length_minutes: number;
  walk_in_allocation_pct: number;
  total_slot_count: number;
  bookable_slot_count: number;
  status: SessionStatus;
  next_serial: number;
  actually_started_at: Date | null;
  actually_ended_at: Date | null;
  change_reason: string | null;
  duty_roster_id: string | null;
  version: number;
}

export class KyselyClinicSessionRepository implements ClinicSessionRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private baseSelect() {
    return this.db
      .selectFrom('scheduling.clinic_session')
      .innerJoin('scheduling.doctor', 'scheduling.doctor.id', 'scheduling.clinic_session.doctor_id')
      .select([
        'scheduling.clinic_session.id as id',
        'scheduling.clinic_session.doctor_id as doctor_id',
        'scheduling.doctor.full_name as doctor_full_name',
        'scheduling.clinic_session.location_id as location_id',
        'scheduling.clinic_session.session_date as session_date',
        'scheduling.clinic_session.starts_at as starts_at',
        'scheduling.clinic_session.ends_at as ends_at',
        'scheduling.clinic_session.slot_length_minutes as slot_length_minutes',
        'scheduling.clinic_session.walk_in_allocation_pct as walk_in_allocation_pct',
        'scheduling.clinic_session.total_slot_count as total_slot_count',
        'scheduling.clinic_session.bookable_slot_count as bookable_slot_count',
        'scheduling.clinic_session.status as status',
        'scheduling.clinic_session.next_serial as next_serial',
        'scheduling.clinic_session.actually_started_at as actually_started_at',
        'scheduling.clinic_session.actually_ended_at as actually_ended_at',
        'scheduling.clinic_session.change_reason as change_reason',
        'scheduling.clinic_session.duty_roster_id as duty_roster_id',
        'scheduling.clinic_session.version as version',
      ]);
  }

  private async toListItem(row: ClinicSessionJoinRow): Promise<ClinicSessionListItem> {
    const bookedSlotCount = await this.countBookedAppointments(row.id);
    return {
      sessionId: row.id,
      doctorId: row.doctor_id,
      doctorName: row.doctor_full_name,
      locationId: row.location_id,
      sessionDate: row.session_date,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      slotLengthMinutes: row.slot_length_minutes,
      walkInAllocationPct: row.walk_in_allocation_pct,
      totalSlotCount: row.total_slot_count,
      bookableSlotCount: row.bookable_slot_count,
      bookedSlotCount,
      status: row.status,
      nextSerial: row.next_serial,
      actuallyStartedAt: row.actually_started_at,
      actuallyEndedAt: row.actually_ended_at,
      changeReason: row.change_reason,
      isOverride: row.duty_roster_id === null,
      version: row.version,
    };
  }

  async listClinicSessions(filter: ClinicSessionListFilter): Promise<readonly ClinicSessionListItem[]> {
    let query = this.baseSelect().where('scheduling.clinic_session.session_date', '>=', filter.from).where('scheduling.clinic_session.session_date', '<=', filter.to);
    if (filter.doctorId !== undefined) query = query.where('scheduling.clinic_session.doctor_id', '=', filter.doctorId);
    if (filter.status !== undefined) query = query.where('scheduling.clinic_session.status', '=', filter.status);

    const rows = await query.orderBy('scheduling.clinic_session.session_date').orderBy('scheduling.clinic_session.starts_at').execute();
    return Promise.all(rows.map((row) => this.toListItem(row)));
  }

  async findClinicSessionById(sessionId: string): Promise<ClinicSessionListItem | null> {
    const row = await this.baseSelect().where('scheduling.clinic_session.id', '=', sessionId).executeTakeFirst();
    return row === undefined ? null : this.toListItem(row);
  }

  async findDoctorLocationId(doctorId: string): Promise<string | null> {
    const row = await this.db.selectFrom('scheduling.doctor').select('location_id').where('id', '=', doctorId).executeTakeFirst();
    return row === undefined ? null : row.location_id;
  }

  async findServiceCalendarClosure(locationId: string, sessionDate: string): Promise<ServiceCalendarClosure | null> {
    const row = await this.db
      .selectFrom('config.service_calendar')
      .select(['id', 'calendar_date', 'reason'])
      .where('location_id', '=', locationId)
      .where('calendar_date', '=', sessionDate)
      .where('is_service_day', '=', false)
      .executeTakeFirst();
    return row === undefined ? null : { id: row.id, calendarDate: row.calendar_date, reason: row.reason };
  }

  async countBookedAppointments(sessionId: string): Promise<number> {
    const row = await this.db
      .selectFrom('queueing.appointment')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('clinic_session_id', '=', sessionId)
      .where('status', 'in', ACTIVE_APPOINTMENT_STATUSES)
      .executeTakeFirst();
    return Number(row?.count ?? '0');
  }

  /** Pre-check mirroring `ex_session_no_overlap`: same doctor, overlapping `[starts_at, ends_at)`, any non-cancelled session. */
  private async findOverlappingSession(doctorId: string, startsAt: Date, endsAt: Date, excludeSessionId?: string): Promise<ClinicSessionListItem | null> {
    let query = this.baseSelect()
      .where('scheduling.clinic_session.doctor_id', '=', doctorId)
      .where('scheduling.clinic_session.status', '!=', 'cancelled')
      .where('scheduling.clinic_session.starts_at', '<', endsAt)
      .where('scheduling.clinic_session.ends_at', '>', startsAt);
    if (excludeSessionId !== undefined) query = query.where('scheduling.clinic_session.id', '!=', excludeSessionId);

    const row = await query.executeTakeFirst();
    return row === undefined ? null : this.toListItem(row);
  }

  async createClinicSession(input: CreateClinicSessionInput): Promise<CreateClinicSessionResult> {
    const preCheck = await this.findOverlappingSession(input.doctorId, input.startsAt, input.endsAt);
    if (preCheck !== null) return { outcome: 'overlap', conflictingSession: preCheck };

    const id = uuidv7();
    try {
      await this.db.transaction().execute(async (trx) => {
        await trx
          .insertInto('scheduling.clinic_session')
          .values({
            id,
            doctor_id: input.doctorId,
            location_id: input.locationId,
            duty_roster_id: input.dutyRosterId,
            session_date: input.sessionDate,
            starts_at: input.startsAt,
            ends_at: input.endsAt,
            slot_length_minutes: input.slotLengthMinutes,
            walk_in_allocation_pct: input.walkInAllocationPct,
            total_slot_count: input.totalSlotCount,
            bookable_slot_count: input.bookableSlotCount,
            change_reason: input.changeReason,
            created_by: input.createdBy,
          })
          .execute();

        for (const slot of input.slots) {
          await trx
            .insertInto('scheduling.session_slot')
            .values({
              id: uuidv7(),
              clinic_session_id: id,
              slot_index: slot.slotIndex,
              slot_starts_at: slot.slotStartsAt,
              is_online_bookable: slot.isOnlineBookable,
            })
            .execute();
        }
      });
    } catch (error) {
      if (isExclusionViolation(error)) {
        const conflict = await this.findOverlappingSession(input.doctorId, input.startsAt, input.endsAt);
        if (conflict !== null) return { outcome: 'overlap', conflictingSession: conflict };
      }
      throw error;
    }

    const session = await this.findClinicSessionById(id);
    if (session === null) throw new Error(`scheduling.clinic_session ${id} vanished immediately after its own creation`);
    return { outcome: 'created', session };
  }

  /**
   * `scheduling.clinic_session` has `trg_clinic_session_version` (unlike
   * `doctor`/`duty_roster`): the trigger itself compares `NEW.version` to
   * `OLD.version` and raises if they differ, then bumps it — so this
   * `UPDATE` must never assign `version` or `updated_at` itself. The
   * `WHERE ... AND version = expectedVersion` clause is what actually
   * implements the optimistic-concurrency check; zero rows affected means
   * either the id doesn't exist or the version was stale.
   */
  async updateClinicSession(input: UpdateClinicSessionInput): Promise<UpdateClinicSessionOutcome> {
    const current = await this.findClinicSessionById(input.sessionId);
    if (current === null) return { outcome: 'not_found' };

    const startsAt = input.startsAt ?? current.startsAt;
    const endsAt = input.endsAt ?? current.endsAt;
    const isRetiming = input.startsAt !== undefined || input.endsAt !== undefined;

    if (isRetiming) {
      const conflict = await this.findOverlappingSession(current.doctorId, startsAt, endsAt, input.sessionId);
      if (conflict !== null) return { outcome: 'overlap', conflictingSession: conflict };
    }

    let row: { id: string } | undefined;
    try {
      row = await this.db
        .updateTable('scheduling.clinic_session')
        .set({
          ...(input.startsAt === undefined ? {} : { starts_at: input.startsAt }),
          ...(input.endsAt === undefined ? {} : { ends_at: input.endsAt }),
          ...(input.slotLengthMinutes === undefined ? {} : { slot_length_minutes: input.slotLengthMinutes }),
          ...(input.walkInAllocationPct === undefined ? {} : { walk_in_allocation_pct: input.walkInAllocationPct }),
          ...(input.totalSlotCount === undefined ? {} : { total_slot_count: input.totalSlotCount }),
          ...(input.bookableSlotCount === undefined ? {} : { bookable_slot_count: input.bookableSlotCount }),
          ...(input.changeReason === undefined ? {} : { change_reason: input.changeReason }),
        })
        .where('id', '=', input.sessionId)
        .where('version', '=', input.expectedVersion)
        .returning('id')
        .executeTakeFirst();
    } catch (error) {
      if (isExclusionViolation(error)) {
        const conflict = await this.findOverlappingSession(current.doctorId, startsAt, endsAt, input.sessionId);
        if (conflict !== null) return { outcome: 'overlap', conflictingSession: conflict };
      }
      throw error;
    }

    if (row === undefined) {
      const stillExists = await this.db.selectFrom('scheduling.clinic_session').select('id').where('id', '=', input.sessionId).executeTakeFirst();
      return stillExists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    if (input.slots !== undefined) {
      await this.db.deleteFrom('scheduling.session_slot').where('clinic_session_id', '=', row.id).execute();
      for (const slot of input.slots) {
        await this.db
          .insertInto('scheduling.session_slot')
          .values({
            id: uuidv7(),
            clinic_session_id: row.id,
            slot_index: slot.slotIndex,
            slot_starts_at: slot.slotStartsAt,
            is_online_bookable: slot.isOnlineBookable,
          })
          .execute();
      }
    }

    const session = await this.findClinicSessionById(row.id);
    if (session === null) throw new Error(`scheduling.clinic_session ${row.id} vanished immediately after its own update`);
    return { outcome: 'updated', session };
  }

  /**
   * "Only slots with `is_online_bookable = true` appear" (API §3.3) — the
   * walk-in allocation is never offered here at all, `availableOnly` or
   * not. A slot's claimed state comes from `queueing.appointment
   * .session_slot_id` (set only for `origin: 'booked'`, per
   * `ck_appointment_walkin_slot`) via the same active-status set
   * `uq_appointment_slot_active` uses, not from any column on the slot
   * itself.
   */
  async listSessionSlots(sessionId: string): Promise<readonly SessionSlotItem[]> {
    const [slotRows, claimedRows] = await Promise.all([
      this.db
        .selectFrom('scheduling.session_slot')
        .select(['id', 'slot_index', 'slot_starts_at'])
        .where('clinic_session_id', '=', sessionId)
        .where('is_online_bookable', '=', true)
        .orderBy('slot_index')
        .execute(),
      this.db
        .selectFrom('queueing.appointment')
        .select('session_slot_id')
        .where('clinic_session_id', '=', sessionId)
        .where('session_slot_id', 'is not', null)
        .where('status', 'in', ACTIVE_APPOINTMENT_STATUSES)
        .execute(),
    ]);

    const claimedSlotIds = new Set(claimedRows.map((row) => row.session_slot_id));

    return slotRows.map((row) => ({
      slotId: row.id,
      slotIndex: row.slot_index,
      slotStartsAt: row.slot_starts_at,
      isAvailable: !claimedSlotIds.has(row.id),
    }));
  }

  async getQueueSummary(sessionId: string): Promise<QueueSummary> {
    const rows = await this.db
      .selectFrom('queueing.appointment')
      .select(['status', ({ fn }) => fn.countAll<string>().as('count')])
      .where('clinic_session_id', '=', sessionId)
      .where('status', 'in', ['waiting', 'completed', 'no_show', 'in_consultation'])
      .groupBy('status')
      .execute();

    const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
    return {
      waiting: counts.get('waiting') ?? 0,
      completed: counts.get('completed') ?? 0,
      noShow: counts.get('no_show') ?? 0,
      inConsultation: counts.get('in_consultation') ?? 0,
    };
  }

  async listOpenAppointments(sessionId: string): Promise<readonly AffectedAppointment[]> {
    const rows = await this.db
      .selectFrom('queueing.appointment')
      .select(['id', 'appointment_ref', 'student_id', 'serial_number'])
      .where('clinic_session_id', '=', sessionId)
      .where('status', 'in', OPEN_APPOINTMENT_STATUSES)
      .execute();
    return rows.map(toAffectedAppointment);
  }

  /** EC-02/FR-APT-25 — resuming from `interrupted` must never overwrite the original `actually_started_at`. */
  async startSession(sessionId: string, expectedVersion: number, now: Date): Promise<StartSessionOutcome> {
    const statusRow = await this.db.selectFrom('scheduling.clinic_session').select('status').where('id', '=', sessionId).executeTakeFirst();
    if (statusRow === undefined) return { outcome: 'not_found' };
    if (!canStart(statusRow.status)) return { outcome: 'invalid_transition' };

    const row = await this.db
      .updateTable('scheduling.clinic_session')
      .set((eb) => ({ status: 'started', actually_started_at: eb.fn.coalesce('actually_started_at', eb.val(now)) }))
      .where('id', '=', sessionId)
      .where('version', '=', expectedVersion)
      .returning('id')
      .executeTakeFirst();

    if (row === undefined) {
      const stillExists = await this.db.selectFrom('scheduling.clinic_session').select('id').where('id', '=', sessionId).executeTakeFirst();
      return stillExists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    const session = await this.findClinicSessionById(row.id);
    if (session === null) throw new Error(`scheduling.clinic_session ${row.id} vanished immediately after its own update`);
    return { outcome: 'started', session };
  }

  /** EC-04 — bookings are never auto-cancelled; only reported so staff can decide (resume, reassign, or cancel). */
  async interruptSession(sessionId: string, expectedVersion: number, reason: string): Promise<InterruptSessionOutcome> {
    const statusRow = await this.db.selectFrom('scheduling.clinic_session').select('status').where('id', '=', sessionId).executeTakeFirst();
    if (statusRow === undefined) return { outcome: 'not_found' };
    if (!canInterrupt(statusRow.status)) return { outcome: 'invalid_transition' };

    const remainingRows = await this.db
      .selectFrom('queueing.appointment')
      .select(['id', 'appointment_ref', 'student_id', 'serial_number'])
      .where('clinic_session_id', '=', sessionId)
      .where('status', 'in', OPEN_APPOINTMENT_STATUSES)
      .execute();

    const row = await this.db
      .updateTable('scheduling.clinic_session')
      .set({ status: 'interrupted', change_reason: reason })
      .where('id', '=', sessionId)
      .where('version', '=', expectedVersion)
      .returning('id')
      .executeTakeFirst();

    if (row === undefined) {
      const stillExists = await this.db.selectFrom('scheduling.clinic_session').select('id').where('id', '=', sessionId).executeTakeFirst();
      return stillExists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    const session = await this.findClinicSessionById(row.id);
    if (session === null) throw new Error(`scheduling.clinic_session ${row.id} vanished immediately after its own update`);
    return { outcome: 'interrupted', session, remainingAppointments: remainingRows.map(toAffectedAppointment) };
  }

  async countInConsultation(sessionId: string): Promise<number> {
    const row = await this.db
      .selectFrom('queueing.appointment')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('clinic_session_id', '=', sessionId)
      .where('status', '=', 'in_consultation')
      .executeTakeFirst();
    return Number(row?.count ?? '0');
  }

  /** BR-22/EC-13 — only appointments still `booked` transition to `expired`; a patient who checked in or was already seen is untouched by this call. */
  async completeSession(sessionId: string, expectedVersion: number, now: Date): Promise<CompleteSessionOutcome> {
    const statusRow = await this.db.selectFrom('scheduling.clinic_session').select('status').where('id', '=', sessionId).executeTakeFirst();
    if (statusRow === undefined) return { outcome: 'not_found' };
    if (!canComplete(statusRow.status)) return { outcome: 'invalid_transition' };
    if ((await this.countInConsultation(sessionId)) > 0) return { outcome: 'consultation_in_progress' };

    const expiredAppointments = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('scheduling.clinic_session')
        .set({ status: 'completed', actually_ended_at: now })
        .where('id', '=', sessionId)
        .where('version', '=', expectedVersion)
        .returning('id')
        .executeTakeFirst();
      if (row === undefined) return undefined;

      return trx
        .updateTable('queueing.appointment')
        .set({ status: 'expired' })
        .where('clinic_session_id', '=', sessionId)
        .where('status', '=', 'booked')
        .returning(['id', 'appointment_ref', 'student_id', 'serial_number'])
        .execute();
    });

    if (expiredAppointments === undefined) {
      const stillExists = await this.db.selectFrom('scheduling.clinic_session').select('id').where('id', '=', sessionId).executeTakeFirst();
      return stillExists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    const session = await this.findClinicSessionById(sessionId);
    if (session === null) throw new Error(`scheduling.clinic_session ${sessionId} vanished immediately after its own update`);
    return { outcome: 'completed', session, expiredAppointments: expiredAppointments.map(toAffectedAppointment) };
  }

  /** BR-26/BR-27 — every open appointment is cancelled with the fixed reason "Doctor Unavailable"; the caller's own `reason` is recorded against the session, not the appointment. */
  async cancelSession(sessionId: string, expectedVersion: number, reason: string): Promise<CancelSessionOutcome> {
    const statusRow = await this.db.selectFrom('scheduling.clinic_session').select('status').where('id', '=', sessionId).executeTakeFirst();
    if (statusRow === undefined) return { outcome: 'not_found' };
    if (!canCancel(statusRow.status)) return { outcome: 'invalid_transition' };

    const cancelledAppointments = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('scheduling.clinic_session')
        .set({ status: 'cancelled', change_reason: reason })
        .where('id', '=', sessionId)
        .where('version', '=', expectedVersion)
        .returning('id')
        .executeTakeFirst();
      if (row === undefined) return undefined;

      return trx
        .updateTable('queueing.appointment')
        .set((eb) => ({ status: 'cancelled', cancelled_at: eb.val(new Date()), cancellation_reason: 'Doctor Unavailable' }))
        .where('clinic_session_id', '=', sessionId)
        .where('status', 'in', OPEN_APPOINTMENT_STATUSES)
        .returning(['id', 'appointment_ref', 'student_id', 'serial_number'])
        .execute();
    });

    if (cancelledAppointments === undefined) {
      const stillExists = await this.db.selectFrom('scheduling.clinic_session').select('id').where('id', '=', sessionId).executeTakeFirst();
      return stillExists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    const session = await this.findClinicSessionById(sessionId);
    if (session === null) throw new Error(`scheduling.clinic_session ${sessionId} vanished immediately after its own update`);
    return { outcome: 'cancelled', session, cancelledAppointments: cancelledAppointments.map(toAffectedAppointment) };
  }

  async findDefaultLocationId(): Promise<string> {
    const row = await this.db.selectFrom('config.location').select('id').orderBy('created_at', 'asc').executeTakeFirst();
    if (row === undefined) {
      throw new Error('config.location has no rows — has 008_scheduling_extensions.sql been migrated?');
    }
    return row.id;
  }

  /** API §2.2 — one entry per date in `[from, to]`, each carrying its service-day status and every non-cancelled session that day. */
  async listPublicAvailability(locationId: string, from: string, to: string, doctorId: string | undefined): Promise<readonly PublicAvailabilityDay[]> {
    let sessionQuery = this.db
      .selectFrom('scheduling.clinic_session')
      .innerJoin('scheduling.doctor', 'scheduling.doctor.id', 'scheduling.clinic_session.doctor_id')
      .select([
        'scheduling.clinic_session.id as id',
        'scheduling.clinic_session.doctor_id as doctor_id',
        'scheduling.doctor.full_name as doctor_name',
        'scheduling.doctor.designation as designation',
        'scheduling.doctor.specialisation as specialisation',
        'scheduling.doctor.photo_url as photo_url',
        'scheduling.clinic_session.session_date as session_date',
        'scheduling.clinic_session.starts_at as starts_at',
        'scheduling.clinic_session.ends_at as ends_at',
        'scheduling.clinic_session.status as status',
        'scheduling.clinic_session.bookable_slot_count as bookable_slot_count',
      ])
      .where('scheduling.clinic_session.location_id', '=', locationId)
      .where('scheduling.clinic_session.session_date', '>=', from)
      .where('scheduling.clinic_session.session_date', '<=', to)
      .where('scheduling.clinic_session.status', '!=', 'cancelled');
    if (doctorId !== undefined) sessionQuery = sessionQuery.where('scheduling.clinic_session.doctor_id', '=', doctorId);

    const [sessionRows, closureRows] = await Promise.all([
      sessionQuery.orderBy('scheduling.clinic_session.starts_at').execute(),
      this.db
        .selectFrom('config.service_calendar')
        .select(['calendar_date', 'is_service_day', 'reason'])
        .where('location_id', '=', locationId)
        .where('calendar_date', '>=', from)
        .where('calendar_date', '<=', to)
        .execute(),
    ]);

    const sessionsWithBookedCount = await Promise.all(
      sessionRows.map(async (row) => ({ row, bookedSlotCount: await this.countBookedAppointments(row.id) })),
    );
    const closuresByDate = new Map(closureRows.map((row) => [row.calendar_date, row]));

    const days: PublicAvailabilityDay[] = [];
    for (const date of enumerateDates(from, to)) {
      const closure = closuresByDate.get(date);
      const isServiceDay = closure?.is_service_day ?? true;
      const sessions: PublicAvailabilityDay['sessions'] = sessionsWithBookedCount
        .filter(({ row }) => row.session_date === date)
        .map(({ row, bookedSlotCount }) => ({
          sessionId: row.id,
          doctorId: row.doctor_id,
          doctorName: row.doctor_name,
          designation: row.designation,
          specialisation: row.specialisation,
          photoUrl: row.photo_url,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          status: row.status,
          bookableSlotCount: row.bookable_slot_count,
          bookedSlotCount,
        }));
      days.push({ date, isServiceDay, closureReason: isServiceDay ? null : (closure?.reason ?? null), sessions });
    }
    return days;
  }
}

function enumerateDates(from: string, to: string): readonly string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
