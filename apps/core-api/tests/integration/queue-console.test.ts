import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { SystemClock } from '../../src/kernel/clock/clock.js';
import { ExpireUnstartedSessionBookingsHandler, GetQueueConsoleQuery, GetSessionQueueQuery, KyselyAppointmentRepository, type AppointmentRepository } from '../../src/modules/queueing/index.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository, ListClinicSessionsQuery, type ClinicSessionRepository } from '../../src/modules/scheduling/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('Queue console reads (M3-E) — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: AppointmentRepository;
  let auditRecorder: AuditRecorder;
  let getQueueConsole: GetQueueConsoleQuery;
  let getSessionQueue: GetSessionQueueQuery;

  let locationId: string;
  let doctorId: string;
  let doctorUserAccountId: string;
  let sessionId: string;
  let emergencySlot: string;
  let normalSlots: string[];
  const createdBy = '01920000-0000-7000-8000-000000009a01';

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });
    repository = new KyselyAppointmentRepository(db);
    auditRecorder = new AuditRecorder(db);

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'queue-console-staff-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    doctorUserAccountId = '01920000-0000-7000-8000-000000009b01';
    await db.insertInto('identity.user_account').values({ id: doctorUserAccountId, email: 'queue-console-doctor-test@diu.edu.bd', full_name: 'Dr. Console', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const doctor = await doctorRepository.createDoctor({ fullName: 'Dr. Console', designation: null, specialisation: null, photoUrl: null, userAccountId: doctorUserAccountId, locationId });
    if (doctor.outcome !== 'created') throw new Error('setup failed');
    doctorId = doctor.doctor.doctorId;

    const clinicSessionRepository: ClinicSessionRepository = new KyselyClinicSessionRepository(db);
    const startsAt = new Date('2026-08-20T09:00:00+06:00');
    const endsAt = new Date('2026-08-20T10:00:00+06:00');
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 0 });
    const session = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: '2026-08-20',
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
    sessionId = session.session.sessionId;

    const slotRows = await db.selectFrom('scheduling.session_slot').select(['id', 'slot_index']).where('clinic_session_id', '=', sessionId).orderBy('slot_index').execute();
    normalSlots = slotRows.slice(0, 3).map((row) => row.id);
    emergencySlot = slotRows[3]?.id ?? '';

    const expireUnstartedSessionBookings = new ExpireUnstartedSessionBookingsHandler(repository, auditRecorder, new SystemClock(), () => Promise.resolve());
    getQueueConsole = new GetQueueConsoleQuery(new ListClinicSessionsQuery(clinicSessionRepository), repository, auditRecorder, expireUnstartedSessionBookings);
    getSessionQueue = new GetSessionQueueQuery(repository, auditRecorder);

    async function bookAt(slotId: string, slotIndex: number, isEmergency: boolean): Promise<void> {
      const studentId = `01920000-0000-7000-8000-0000000091${String(slotIndex).padStart(2, '0')}`;
      await db.insertInto('identity.user_account').values({ id: studentId, email: `queue-console-student-${String(slotIndex)}-test@diu.edu.bd`, full_name: `Student ${String(slotIndex)}`, status: 'active' }).execute();
      await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: `221-15-94${String(slotIndex).padStart(2, '0')}`, is_enrolled: true }).execute();

      const slot = await db.selectFrom('scheduling.session_slot').select('slot_starts_at').where('id', '=', slotId).executeTakeFirstOrThrow();
      const outcome = await repository.createBooking({
        slot: { slotId, sessionId, doctorId, doctorName: 'Dr. Console', locationId, sessionDate: '2026-08-20', slotStartsAt: slot.slot_starts_at, sessionStartsAt: startsAt, isOnlineBookable: true },
        studentId,
        visitReasonCategoryId: null,
        visitReasonNote: null,
        createdBy: studentId,
      });
      if (outcome.outcome !== 'created') throw new Error('setup failed');

      if (isEmergency) {
        await db.updateTable('queueing.appointment').set({ is_emergency: true, emergency_reason: 'Setup fixture emergency' }).where('id', '=', outcome.appointment.appointmentId).execute();
      }
    }

    await bookAt(normalSlots[0] ?? '', 1, false);
    await bookAt(normalSlots[1] ?? '', 2, false);
    await bookAt(emergencySlot, 4, true);
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('GetQueueConsoleQuery orders the emergency ahead of earlier serials, and writes one data-access log entry per distinct student', async () => {
    const result = await getQueueConsole.execute('2026-08-20', undefined, createdBy, 'test-correlation');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = result.value.find((item) => item.sessionId === sessionId);
    expect(session).toBeDefined();
    if (session === undefined) return;
    expect(session.queue[0]?.isEmergency).toBe(true);
    expect(session.queue.map((row) => row.serialNumber)).toEqual([3, 1, 2]);
    expect(session.counts.waiting + session.counts.checkedIn + session.counts.inConsultation).toBe(0);

    const accessLog = await db.selectFrom('audit.data_access_log').select('subject_id').where('correlation_id', '=', 'test-correlation').execute();
    expect(accessLog).toHaveLength(3);
  });

  it('GetSessionQueueQuery: DOC sees their own session, a different doctor gets null (404, not 403)', async () => {
    const own = await getSessionQueue.execute(sessionId, { role: 'DOC', userId: doctorUserAccountId }, 'c2');
    expect(own).not.toBeNull();
    expect(own?.queue).not.toBeNull();

    const notOwn = await getSessionQueue.execute(sessionId, { role: 'DOC', userId: 'some-other-doctor-user-id' }, 'c2');
    expect(notOwn).toBeNull();
  });

  it('GetSessionQueueQuery: ADM gets counts but queue is null', async () => {
    const result = await getSessionQueue.execute(sessionId, { role: 'ADM', userId: 'admin-1' }, 'c3');
    expect(result).not.toBeNull();
    expect(result?.queue).toBeNull();
    expect(result?.counts).toBeDefined();
  });

  it('GetSessionQueueQuery: MCS gets the full queue, correctly ordered', async () => {
    const result = await getSessionQueue.execute(sessionId, { role: 'MCS', userId: createdBy }, 'c4');
    expect(result).not.toBeNull();
    expect(result?.queue?.map((row) => row.serialNumber)).toEqual([3, 1, 2]);
    expect(result?.nowServingSerial).toBeNull();
  });
});
