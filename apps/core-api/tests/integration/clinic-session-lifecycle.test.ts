import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

function buildCreateInput(doctorId: string, locationId: string, startsAt: Date, endsAt: Date, createdBy: string) {
  const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 30 });
  return {
    doctorId,
    locationId,
    dutyRosterId: null,
    sessionDate: startsAt.toISOString().slice(0, 10),
    startsAt,
    endsAt,
    slotLengthMinutes: 10,
    walkInAllocationPct: 30,
    changeReason: null,
    totalSlotCount: derived.totalSlotCount,
    bookableSlotCount: derived.bookableSlotCount,
    slots: derived.slots,
    createdBy,
  };
}

describe('KyselyClinicSessionRepository — lifecycle integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyClinicSessionRepository;
  let doctorId: string;
  let locationId: string;
  const createdBy = '01920000-0000-7000-8000-000000004a01';
  let appointmentCounter = 0;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    repository = new KyselyClinicSessionRepository(db);

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'clinic-lifecycle-staff-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const created = await doctorRepository.createDoctor({ fullName: 'Dr. Lifecycle', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (created.outcome !== 'created') throw new Error('setup failed');
    doctorId = created.doctor.doctorId;
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  /** A fresh student per call — `uq_appointment_student_session_active` allows only one active booking per student per session, and several tests need multiple simultaneously-active appointments in the same session. */
  async function insertAppointment(
    sessionId: string,
    status: 'booked' | 'checked_in' | 'waiting' | 'in_consultation' | 'completed',
    serialNumber: number,
  ): Promise<{ readonly appointmentId: string; readonly studentId: string }> {
    appointmentCounter += 1;
    const suffix = String(appointmentCounter).padStart(2, '0');
    const appointmentId = `01920000-0000-7000-8000-0000000050${suffix}`;
    const studentId = `01920000-0000-7000-8000-0000000051${suffix}`;

    await db.insertInto('identity.user_account').values({ id: studentId, email: `clinic-lifecycle-student-${suffix}-test@diu.edu.bd`, full_name: 'A Student', status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: `221-15-90${suffix}`, is_enrolled: true }).execute();

    await db
      .insertInto('queueing.appointment')
      .values({
        id: appointmentId,
        appointment_ref: `MED-2026-LC${suffix}`,
        clinic_session_id: sessionId,
        session_slot_id: null,
        student_id: studentId,
        serial_number: serialNumber,
        origin: 'walk_in',
        status,
        created_by: createdBy,
      })
      .execute();
    return { appointmentId, studentId };
  }

  it('startSession: scheduled → started, sets actuallyStartedAt; rejects a second start; detects a stale version', async () => {
    const created = await repository.createClinicSession(buildCreateInput(doctorId, locationId, new Date('2026-08-11T09:00:00+06:00'), new Date('2026-08-11T13:00:00+06:00'), createdBy));
    if (created.outcome !== 'created') throw new Error('setup failed');
    const sessionId = created.session.sessionId;

    const now = new Date('2026-08-11T03:05:00.000Z');
    const started = await repository.startSession(sessionId, 1, now);
    expect(started.outcome).toBe('started');
    if (started.outcome === 'started') {
      expect(started.session.status).toBe('started');
      expect(started.session.actuallyStartedAt).toEqual(now);
      expect(started.session.version).toBe(2);
    }

    const alreadyStarted = await repository.startSession(sessionId, 2, now);
    expect(alreadyStarted.outcome).toBe('invalid_transition');

    // Interrupting makes it startable again (resuming) — version is now 3.
    const interrupted = await repository.interruptSession(sessionId, 2, 'Doctor called to an emergency in the hostel block');
    expect(interrupted.outcome).toBe('interrupted');

    const stale = await repository.startSession(sessionId, 2, now);
    expect(stale.outcome).toBe('stale');

    const resumed = await repository.startSession(sessionId, 3, now);
    expect(resumed.outcome).toBe('started');

    const missing = await repository.startSession('01920000-0000-7000-8000-0000000000ff', 1, now);
    expect(missing.outcome).toBe('not_found');
  });

  it('interruptSession: reports every open appointment as remaining, never touches their status, records the reason', async () => {
    const created = await repository.createClinicSession(buildCreateInput(doctorId, locationId, new Date('2026-08-12T09:00:00+06:00'), new Date('2026-08-12T13:00:00+06:00'), createdBy));
    if (created.outcome !== 'created') throw new Error('setup failed');
    const sessionId = created.session.sessionId;
    await repository.startSession(sessionId, 1, new Date());

    const open = await insertAppointment(sessionId, 'waiting', 1);
    await insertAppointment(sessionId, 'completed', 2); // already seen — must not appear as "remaining"

    const interrupted = await repository.interruptSession(sessionId, 2, 'Doctor called to an emergency in the hostel block');
    expect(interrupted.outcome).toBe('interrupted');
    if (interrupted.outcome === 'interrupted') {
      expect(interrupted.session.status).toBe('interrupted');
      expect(interrupted.session.changeReason).toBe('Doctor called to an emergency in the hostel block');
      expect(interrupted.remainingAppointments).toHaveLength(1);
      expect(interrupted.remainingAppointments[0]).toEqual(expect.objectContaining({ appointmentId: open.appointmentId, studentId: open.studentId }));
    }

    const stillWaiting = await db.selectFrom('queueing.appointment').select('status').where('id', '=', open.appointmentId).executeTakeFirstOrThrow();
    expect(stillWaiting.status).toBe('waiting'); // EC-04: never auto-cancelled

    // Resuming must not overwrite the original actuallyStartedAt.
    const beforeResume = await repository.findClinicSessionById(sessionId);
    const resumed = await repository.startSession(sessionId, 3, new Date());
    expect(resumed.outcome).toBe('started');
    if (resumed.outcome === 'started' && beforeResume !== null) {
      expect(resumed.session.actuallyStartedAt).toEqual(beforeResume.actuallyStartedAt);
    }
  });

  it('completeSession: refuses while a consultation is in progress; only "booked" appointments expire, others are untouched', async () => {
    const created = await repository.createClinicSession(buildCreateInput(doctorId, locationId, new Date('2026-08-13T09:00:00+06:00'), new Date('2026-08-13T13:00:00+06:00'), createdBy));
    if (created.outcome !== 'created') throw new Error('setup failed');
    const sessionId = created.session.sessionId;
    await repository.startSession(sessionId, 1, new Date());

    const inConsultation = await insertAppointment(sessionId, 'in_consultation', 1);
    expect(await repository.countInConsultation(sessionId)).toBe(1);

    const blocked = await repository.completeSession(sessionId, 2, new Date());
    expect(blocked.outcome).toBe('consultation_in_progress');

    await db.updateTable('queueing.appointment').set({ status: 'completed' }).where('id', '=', inConsultation.appointmentId).execute();
    const booked = await insertAppointment(sessionId, 'booked', 2);
    const waiting = await insertAppointment(sessionId, 'waiting', 3);

    const completed = await repository.completeSession(sessionId, 2, new Date('2026-08-13T07:24:00.000Z'));
    expect(completed.outcome).toBe('completed');
    if (completed.outcome === 'completed') {
      expect(completed.session.status).toBe('completed');
      expect(completed.session.actuallyEndedAt).toEqual(new Date('2026-08-13T07:24:00.000Z'));
      expect(completed.expiredAppointments).toEqual([expect.objectContaining({ appointmentId: booked.appointmentId })]);
    }

    const bookedRow = await db.selectFrom('queueing.appointment').select('status').where('id', '=', booked.appointmentId).executeTakeFirstOrThrow();
    expect(bookedRow.status).toBe('expired');
    const waitingRow = await db.selectFrom('queueing.appointment').select('status').where('id', '=', waiting.appointmentId).executeTakeFirstOrThrow();
    expect(waitingRow.status).toBe('waiting'); // untouched — API §3.3 only speaks to "still booked"
  });

  it('cancelSession: cancels every open appointment with the fixed reason, listOpenAppointments previews the same set beforehand', async () => {
    const created = await repository.createClinicSession(buildCreateInput(doctorId, locationId, new Date('2026-08-14T09:00:00+06:00'), new Date('2026-08-14T13:00:00+06:00'), createdBy));
    if (created.outcome !== 'created') throw new Error('setup failed');
    const sessionId = created.session.sessionId;

    const booked = await insertAppointment(sessionId, 'booked', 1);
    await insertAppointment(sessionId, 'completed', 2);

    const preview = await repository.listOpenAppointments(sessionId);
    expect(preview).toEqual([expect.objectContaining({ appointmentId: booked.appointmentId })]);

    const cancelled = await repository.cancelSession(sessionId, 1, 'Doctor called to an emergency at the main campus');
    expect(cancelled.outcome).toBe('cancelled');
    if (cancelled.outcome === 'cancelled') {
      expect(cancelled.session.status).toBe('cancelled');
      expect(cancelled.session.changeReason).toBe('Doctor called to an emergency at the main campus');
      expect(cancelled.cancelledAppointments).toEqual([expect.objectContaining({ appointmentId: booked.appointmentId })]);
    }

    const cancelledRow = await db.selectFrom('queueing.appointment').select(['status', 'cancellation_reason']).where('id', '=', booked.appointmentId).executeTakeFirstOrThrow();
    expect(cancelledRow).toEqual({ status: 'cancelled', cancellation_reason: 'Doctor Unavailable' });

    const alreadyCancelled = await repository.cancelSession(sessionId, 2, 'Trying again');
    expect(alreadyCancelled.outcome).toBe('invalid_transition');
  });
});
