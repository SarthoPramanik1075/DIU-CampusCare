import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import {
  ExpireUnstartedSessionBookingsHandler,
  GetQueueConsoleQuery,
  KyselyAppointmentRepository,
  type AppointmentRepository,
} from '../../src/modules/queueing/index.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository, ListClinicSessionsQuery, type ClinicSessionRepository } from '../../src/modules/scheduling/index.js';
import { FixedClock } from '../support/fixed-clock.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('Session expiry sweep (M3-H, FR-APT-33/BR-22/EC-13) — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: AppointmentRepository;
  let auditRecorder: AuditRecorder;
  let clock: FixedClock;
  let sentNotifications: { readonly recipientId: string; readonly templateKey: string }[];
  let expireHandler: ExpireUnstartedSessionBookingsHandler;

  let locationId: string;
  let doctorId: string;
  const createdBy = '01920000-0000-7000-8000-000000005a01';
  let counter = 0;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });
    repository = new KyselyAppointmentRepository(db);
    auditRecorder = new AuditRecorder(db);
    clock = new FixedClock(new Date('2026-08-25T05:00:00Z'));

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'expiry-sweep-staff-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const doctor = await doctorRepository.createDoctor({ fullName: 'Dr. Expiry', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (doctor.outcome !== 'created') throw new Error('setup failed');
    doctorId = doctor.doctor.doctorId;
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  async function createSession(sessionDate: string, startsAt: Date, endsAt: Date, status: 'scheduled' | 'started' | 'completed'): Promise<{ readonly sessionId: string; readonly slots: readonly string[] }> {
    const clinicSessionRepository: ClinicSessionRepository = new KyselyClinicSessionRepository(db);
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 0 });
    const session = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate,
      startsAt,
      endsAt,
      slotLengthMinutes: 10,
      walkInAllocationPct: 0,
      changeReason: null,
      totalSlotCount: derived.totalSlotCount,
      bookableSlotCount: derived.bookableSlotCount,
      slots: derived.slots,
      createdBy,
    });
    if (session.outcome !== 'created') throw new Error('setup failed');
    if (status !== 'scheduled') {
      await db.updateTable('scheduling.clinic_session').set({ status, actually_started_at: startsAt }).where('id', '=', session.session.sessionId).execute();
    }
    const slotRows = await db.selectFrom('scheduling.session_slot').select('id').where('clinic_session_id', '=', session.session.sessionId).orderBy('slot_index').execute();
    return { sessionId: session.session.sessionId, slots: slotRows.map((row) => row.id) };
  }

  async function bookOnSession(sessionId: string, slots: readonly string[], slotIndex: number, sessionDate: string, startsAt: Date): Promise<{ readonly appointmentId: string; readonly studentId: string }> {
    counter += 1;
    const suffix = String(counter).padStart(2, '0');
    const studentId = `01920000-0000-7000-8000-0000000051${suffix}`;
    await db.insertInto('identity.user_account').values({ id: studentId, email: `expiry-sweep-student-${suffix}-test@diu.edu.bd`, full_name: `Student ${suffix}`, status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: `221-25-90${suffix}`, is_enrolled: true }).execute();

    const slotId = slots[slotIndex];
    if (slotId === undefined) throw new Error('setup failed: not enough slots');
    const slotRow = await db.selectFrom('scheduling.session_slot').select('slot_starts_at').where('id', '=', slotId).executeTakeFirstOrThrow();

    const outcome = await repository.createBooking({
      slot: { slotId, sessionId, doctorId, doctorName: 'Dr. Expiry', locationId, sessionDate, slotStartsAt: slotRow.slot_starts_at, sessionStartsAt: startsAt, isOnlineBookable: true },
      studentId,
      visitReasonCategoryId: null,
      visitReasonNote: null,
      createdBy: studentId,
    });
    if (outcome.outcome !== 'created') throw new Error('setup failed: slot already taken');
    return { appointmentId: outcome.appointment.appointmentId, studentId };
  }

  it('expires booked appointments in a session that ended without ever being started, but leaves a started session\'s stragglers alone', async () => {
    sentNotifications = [];
    expireHandler = new ExpireUnstartedSessionBookingsHandler(repository, auditRecorder, clock, (input) => {
      sentNotifications.push({ recipientId: input.recipientId, templateKey: input.templateKey });
      return Promise.resolve();
    });

    // Session A: ended two hours ago (relative to `clock`), never started — the case this sweep exists for.
    const sessionA = await createSession('2026-08-24', new Date('2026-08-24T09:00:00+06:00'), new Date('2026-08-24T10:00:00+06:00'), 'scheduled');
    const a1 = await bookOnSession(sessionA.sessionId, sessionA.slots, 0, '2026-08-24', new Date('2026-08-24T09:00:00+06:00'));
    const a2 = await bookOnSession(sessionA.sessionId, sessionA.slots, 1, '2026-08-24', new Date('2026-08-24T09:00:00+06:00'));

    // Session B: also ended, but staff DID start it — CompleteSessionHandler's job, not this sweep's.
    // A different time on the same date, to avoid the doctor's overlap constraint with session A.
    const sessionB = await createSession('2026-08-24', new Date('2026-08-24T11:00:00+06:00'), new Date('2026-08-24T12:00:00+06:00'), 'started');
    const b1 = await bookOnSession(sessionB.sessionId, sessionB.slots, 0, '2026-08-24', new Date('2026-08-24T11:00:00+06:00'));

    // Session C: in the future — must never be swept.
    const sessionC = await createSession('2026-09-01', new Date('2026-09-01T09:00:00+06:00'), new Date('2026-09-01T10:00:00+06:00'), 'scheduled');
    const c1 = await bookOnSession(sessionC.sessionId, sessionC.slots, 0, '2026-09-01', new Date('2026-09-01T09:00:00+06:00'));

    const result = await expireHandler.execute('sweep-1');

    expect(result.sessionsSwept).toBe(1);
    expect(result.appointmentsExpired).toBe(2);

    const a1After = await repository.findAppointmentDetail(a1.appointmentId);
    const a2After = await repository.findAppointmentDetail(a2.appointmentId);
    expect(a1After?.status).toBe('expired');
    expect(a2After?.status).toBe('expired');

    const b1After = await repository.findAppointmentDetail(b1.appointmentId);
    expect(b1After?.status).toBe('booked');

    const c1After = await repository.findAppointmentDetail(c1.appointmentId);
    expect(c1After?.status).toBe('booked');

    expect(sentNotifications.filter((n) => n.templateKey === 'session_expired_rebooking_offer')).toHaveLength(2);
    expect(sentNotifications.some((n) => n.recipientId === a1.studentId)).toBe(true);
    expect(sentNotifications.some((n) => n.recipientId === a2.studentId)).toBe(true);

    // A second sweep finds nothing left to expire — no re-notification.
    sentNotifications = [];
    const second = await expireHandler.execute('sweep-2');
    expect(second).toEqual({ sessionsSwept: 0, appointmentsExpired: 0 });
    expect(sentNotifications).toHaveLength(0);
  });

  it('GetQueueConsoleQuery reads the swept status without a separate manual call', async () => {
    sentNotifications = [];
    const notify = (input: { recipientId: string; templateKey: string }): Promise<void> => {
      sentNotifications.push({ recipientId: input.recipientId, templateKey: input.templateKey });
      return Promise.resolve();
    };
    const expire = new ExpireUnstartedSessionBookingsHandler(repository, auditRecorder, clock, notify);

    const session = await createSession('2026-08-24', new Date('2026-08-24T13:00:00+06:00'), new Date('2026-08-24T14:00:00+06:00'), 'scheduled');
    const booking = await bookOnSession(session.sessionId, session.slots, 0, '2026-08-24', new Date('2026-08-24T13:00:00+06:00'));

    const clinicSessionRepository: ClinicSessionRepository = new KyselyClinicSessionRepository(db);
    const getQueueConsole = new GetQueueConsoleQuery(new ListClinicSessionsQuery(clinicSessionRepository), repository, auditRecorder, expire);

    const result = await getQueueConsole.execute('2026-08-24', undefined, createdBy, 'console-sweep-correlation');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sessionRow = result.value.find((item) => item.sessionId === session.sessionId);
    expect(sessionRow?.queue.find((row) => row.appointmentId === booking.appointmentId)?.status).toBe('expired');
  });
});
