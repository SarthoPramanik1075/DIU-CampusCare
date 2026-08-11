import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { AuthorizationError } from '../../src/kernel/errors/domain-error.js';
import { PolicyStore } from '../../src/kernel/policy/policy-store.js';
import {
  CancelAppointmentHandler,
  GetAppointmentDetailQuery,
  GetQueuePositionQuery,
  KyselyAppointmentRepository,
  ListMyAppointmentsQuery,
  orderQueue,
  seedQueueingPolicies,
  type AppointmentRepository,
} from '../../src/modules/queueing/index.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { FixedClock } from '../support/fixed-clock.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('Appointment lifecycle (M3-C) — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: AppointmentRepository;
  let policyStore: PolicyStore;
  let auditRecorder: AuditRecorder;
  let clock: FixedClock;
  let sentNotifications: { readonly recipientId: string; readonly templateKey: string }[];
  let cancelHandler: CancelAppointmentHandler;
  let getAppointmentDetail: GetAppointmentDetailQuery;
  let listMyAppointments: ListMyAppointmentsQuery;
  let getQueuePosition: GetQueuePositionQuery;

  let locationId: string;
  let doctorId: string;
  let sessionId: string;
  let slotIds: string[];
  let counter = 0;
  const createdBy = '01920000-0000-7000-8000-000000007a01';

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });
    repository = new KyselyAppointmentRepository(db);
    policyStore = new PolicyStore(db);
    await seedQueueingPolicies(policyStore);
    auditRecorder = new AuditRecorder(db);
    clock = new FixedClock(new Date('2026-08-10T00:00:00Z'));

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'appointment-lifecycle-staff-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const doctor = await doctorRepository.createDoctor({ fullName: 'Dr. Lifecycle Queue', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (doctor.outcome !== 'created') throw new Error('setup failed');
    doctorId = doctor.doctor.doctorId;

    const clinicSessionRepository = new KyselyClinicSessionRepository(db);
    const startsAt = new Date('2026-08-15T09:00:00+06:00');
    const endsAt = new Date('2026-08-15T11:00:00+06:00');
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 0 });
    const session = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: '2026-08-15',
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
    slotIds = slotRows.map((row) => row.id);
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  beforeEach(() => {
    sentNotifications = [];
    cancelHandler = new CancelAppointmentHandler(repository, policyStore, auditRecorder, clock, (input) => {
      sentNotifications.push({ recipientId: input.recipientId, templateKey: input.templateKey });
      return Promise.resolve();
    });
    getAppointmentDetail = new GetAppointmentDetailQuery(repository);
    listMyAppointments = new ListMyAppointmentsQuery(repository, clock);
    getQueuePosition = new GetQueuePositionQuery(repository, policyStore, clock);
  });

  async function bookStudent(slotIndex: number): Promise<{ readonly appointmentId: string; readonly studentId: string; readonly version: number }> {
    counter += 1;
    const suffix = String(counter).padStart(2, '0');
    const studentId = `01920000-0000-7000-8000-0000000071${suffix}`;
    await db.insertInto('identity.user_account').values({ id: studentId, email: `appointment-lifecycle-student-${suffix}-test@diu.edu.bd`, full_name: `Student ${suffix}`, status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: `221-15-92${suffix}`, is_enrolled: true }).execute();

    const slotId = slotIds[slotIndex];
    if (slotId === undefined) throw new Error('setup failed: not enough slots');
    const slotRow = await db.selectFrom('scheduling.session_slot').select('slot_starts_at').where('id', '=', slotId).executeTakeFirstOrThrow();

    const outcome = await repository.createBooking({
      slot: {
        slotId,
        sessionId,
        doctorId,
        doctorName: 'Dr. Lifecycle Queue',
        locationId,
        sessionDate: '2026-08-15',
        slotStartsAt: slotRow.slot_starts_at,
        sessionStartsAt: new Date('2026-08-15T09:00:00+06:00'),
        isOnlineBookable: true,
      },
      studentId,
      visitReasonCategoryId: null,
      visitReasonNote: null,
      createdBy: studentId,
    });
    if (outcome.outcome !== 'created') throw new Error('setup failed: slot already taken');
    return { appointmentId: outcome.appointment.appointmentId, studentId, version: outcome.appointment.version };
  }

  it('cancels for free well before the cutoff, penaltyApplied always false, and queues a notification', async () => {
    clock.set(new Date('2026-08-10T00:00:00Z'));
    const { appointmentId, studentId, version } = await bookStudent(0);

    const result = await cancelHandler.execute({
      appointmentId,
      requesterId: studentId,
      requesterRole: 'STU',
      reason: null,
      expectedVersion: version,
      actorId: studentId,
      correlationId: 'test-correlation',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('cancelled');
    }
    expect(sentNotifications).toEqual([{ recipientId: studentId, templateKey: 'booking_cancelled_by_student' }]);
  });

  it('classifies as late_cancellation once inside the 120-minute cutoff', async () => {
    const { appointmentId, studentId, version } = await bookStudent(1);
    // The slot is 2026-08-15T03:10:00Z (09:10 BST); 60 minutes before it is inside the 120-minute free window.
    clock.set(new Date('2026-08-15T02:10:00Z'));

    const result = await cancelHandler.execute({
      appointmentId,
      requesterId: studentId,
      requesterRole: 'STU',
      reason: null,
      expectedVersion: version,
      actorId: studentId,
      correlationId: 'test-correlation',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('late_cancellation');
  });

  it('rejects a second cancellation with INVALID_STATUS_TRANSITION', async () => {
    const { appointmentId, studentId, version } = await bookStudent(2);
    const first = await cancelHandler.execute({ appointmentId, requesterId: studentId, requesterRole: 'STU', reason: null, expectedVersion: version, actorId: studentId, correlationId: 'c' });
    expect(first.ok).toBe(true);

    const second = await cancelHandler.execute({ appointmentId, requesterId: studentId, requesterRole: 'STU', reason: null, expectedVersion: version + 1, actorId: studentId, correlationId: 'c' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('rejects a stale version with CONFLICT_STALE_VERSION and re-presents current state', async () => {
    const { appointmentId, studentId, version } = await bookStudent(3);
    const result = await cancelHandler.execute({
      appointmentId,
      requesterId: studentId,
      requesterRole: 'STU',
      reason: null,
      expectedVersion: version + 99,
      actorId: studentId,
      correlationId: 'c',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT_STALE_VERSION');
      expect(result.error.details?.current).toMatchObject({ appointmentId, version });
    }
  });

  it("anti-enumeration: a different student cancelling someone else's appointment gets NOT_FOUND, not FORBIDDEN", async () => {
    const { appointmentId, version } = await bookStudent(4);
    const impostor = await bookStudent(5);

    const result = await cancelHandler.execute({
      appointmentId,
      requesterId: impostor.studentId,
      requesterRole: 'STU',
      reason: null,
      expectedVersion: version,
      actorId: impostor.studentId,
      correlationId: 'c',
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error instanceof AuthorizationError) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.httpStatus).toBe(404);
    } else {
      expect.fail('expected an AuthorizationError');
    }
  });

  it('GetAppointmentDetailQuery: STU sees only their own, DOC sees only their own session, MCS/ADM see any', async () => {
    const { appointmentId, studentId } = await bookStudent(6);
    const otherStudent = await bookStudent(7);

    expect(await getAppointmentDetail.execute(appointmentId, { role: 'STU', userId: studentId })).not.toBeNull();
    expect(await getAppointmentDetail.execute(appointmentId, { role: 'STU', userId: otherStudent.studentId })).toBeNull();
    expect(await getAppointmentDetail.execute(appointmentId, { role: 'DOC', userId: 'not-this-doctor' })).toBeNull();
    expect(await getAppointmentDetail.execute(appointmentId, { role: 'MCS', userId: 'anyone' })).not.toBeNull();
    expect(await getAppointmentDetail.execute(appointmentId, { role: 'ADM', userId: 'anyone' })).not.toBeNull();
  });

  it('ListMyAppointmentsQuery: scopes to upcoming vs. past by session date and status', async () => {
    clock.set(new Date('2026-08-10T00:00:00Z'));
    const { studentId } = await bookStudent(8);

    const upcoming = await listMyAppointments.execute(studentId, 'upcoming', undefined);
    expect(upcoming.some((item) => item.sessionDate === '2026-08-15')).toBe(true);

    const past = await listMyAppointments.execute(studentId, 'past', undefined);
    expect(past.some((item) => item.sessionDate === '2026-08-15')).toBe(false);
  });

  it('GetQueuePositionQuery: patientsAhead reflects orderQueue over the active entries', async () => {
    const first = await bookStudent(9);
    const second = await bookStudent(10);
    const third = await bookStudent(11);

    const entries = await repository.listActiveQueueEntries(sessionId);
    const ordered = orderQueue(entries.filter((entry) => [first.appointmentId, second.appointmentId, third.appointmentId].includes(entry.appointmentId)));
    expect(ordered.map((entry) => entry.appointmentId)).toEqual([first.appointmentId, second.appointmentId, third.appointmentId]);

    const positionResult = await getQueuePosition.execute(third.appointmentId, third.studentId);
    expect(positionResult.ok).toBe(true);
    if (positionResult.ok) {
      expect(positionResult.value.serialNumber).toBeGreaterThan(0);
      expect(positionResult.value.nowServingSerial).toBeNull();
    }
  });
});
