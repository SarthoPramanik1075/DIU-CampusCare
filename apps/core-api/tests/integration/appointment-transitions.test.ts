import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { PolicyStore } from '../../src/kernel/policy/policy-store.js';
import {
  AdvanceAppointmentHandler,
  CheckInAppointmentHandler,
  KyselyAppointmentRepository,
  KyselyBookingSuspensionRepository,
  MarkEmergencyHandler,
  MarkNoShowHandler,
  ReverseAppointmentStatusHandler,
  seedQueueingPolicies,
  type AppointmentRepository,
  type BookingSuspensionRepository,
} from '../../src/modules/queueing/index.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { FixedClock } from '../support/fixed-clock.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('Queue transitions (M3-F) — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: AppointmentRepository;
  let suspensionRepository: BookingSuspensionRepository;
  let policyStore: PolicyStore;
  let auditRecorder: AuditRecorder;
  let clock: FixedClock;
  let sentNotifications: { readonly recipientId: string; readonly templateKey: string }[];
  let checkIn: CheckInAppointmentHandler;
  let advance: AdvanceAppointmentHandler;
  let markNoShow: MarkNoShowHandler;
  let reverse: ReverseAppointmentStatusHandler;
  let markEmergency: MarkEmergencyHandler;

  let locationId: string;
  let doctorId: string;
  let sessionAId: string;
  let sessionASlots: string[];
  const createdBy = '01920000-0000-7000-8000-000000008a01';
  const SESSION_A_START = new Date('2026-08-20T09:00:00+06:00');
  const SESSION_A_DATE = '2026-08-20';
  let counter = 0;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });
    repository = new KyselyAppointmentRepository(db);
    suspensionRepository = new KyselyBookingSuspensionRepository(db);
    policyStore = new PolicyStore(db);
    await seedQueueingPolicies(policyStore);
    auditRecorder = new AuditRecorder(db);
    clock = new FixedClock(new Date('2026-08-20T04:00:00Z'));

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'transitions-staff-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const doctor = await doctorRepository.createDoctor({ fullName: 'Dr. Transitions', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (doctor.outcome !== 'created') throw new Error('setup failed');
    doctorId = doctor.doctor.doctorId;

    const clinicSessionRepository = new KyselyClinicSessionRepository(db);
    const endsAt = new Date('2026-08-20T11:00:00+06:00');
    const derived = deriveSlots({ startsAt: SESSION_A_START, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 0 });
    const session = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: SESSION_A_DATE,
      startsAt: SESSION_A_START,
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
    sessionAId = session.session.sessionId;
    await db.updateTable('scheduling.clinic_session').set({ status: 'started', actually_started_at: clock.now() }).where('id', '=', sessionAId).execute();

    const slotRows = await db.selectFrom('scheduling.session_slot').select(['id', 'slot_index']).where('clinic_session_id', '=', sessionAId).orderBy('slot_index').execute();
    sessionASlots = slotRows.map((row) => row.id);
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  beforeEach(() => {
    sentNotifications = [];
    const notify = (input: { recipientId: string; templateKey: string }): Promise<void> => {
      sentNotifications.push({ recipientId: input.recipientId, templateKey: input.templateKey });
      return Promise.resolve();
    };
    checkIn = new CheckInAppointmentHandler(repository, auditRecorder, clock);
    advance = new AdvanceAppointmentHandler(repository, auditRecorder, clock);
    markNoShow = new MarkNoShowHandler(repository, suspensionRepository, policyStore, auditRecorder, clock, notify);
    reverse = new ReverseAppointmentStatusHandler(repository, suspensionRepository, policyStore, auditRecorder, clock);
    markEmergency = new MarkEmergencyHandler(repository, policyStore, auditRecorder, clock, notify);
  });

  async function bookOnSessionA(slotIndex: number): Promise<{ readonly appointmentId: string; readonly studentId: string; readonly version: number }> {
    counter += 1;
    const suffix = String(counter).padStart(2, '0');
    const studentId = `01920000-0000-7000-8000-0000000081${suffix}`;
    await db.insertInto('identity.user_account').values({ id: studentId, email: `transitions-student-${suffix}-test@diu.edu.bd`, full_name: `Student ${suffix}`, status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: `221-15-93${suffix}`, is_enrolled: true }).execute();

    const slotId = sessionASlots[slotIndex];
    if (slotId === undefined) throw new Error('setup failed: not enough slots');
    const slotRow = await db.selectFrom('scheduling.session_slot').select('slot_starts_at').where('id', '=', slotId).executeTakeFirstOrThrow();

    const outcome = await repository.createBooking({
      slot: {
        slotId,
        sessionId: sessionAId,
        doctorId,
        doctorName: 'Dr. Transitions',
        locationId,
        sessionDate: SESSION_A_DATE,
        slotStartsAt: slotRow.slot_starts_at,
        sessionStartsAt: SESSION_A_START,
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

  it('checks in a booked patient, computes position/permittedTransitions, and replays idempotently', async () => {
    const { appointmentId, version } = await bookOnSessionA(0);

    const first = await checkIn.execute({ appointmentId, expectedVersion: version, idempotencyKey: 'ck-1', actorId: createdBy, correlationId: 'c' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.appointment.status).toBe('checked_in');
    expect(first.value.permittedTransitions).toEqual(['waiting']);
    expect(first.value.replay).toBe(false);
    const checkedInVersion = first.value.appointment.version;

    const replay = await checkIn.execute({ appointmentId, expectedVersion: version, idempotencyKey: 'ck-1', actorId: createdBy, correlationId: 'c' });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.value.replay).toBe(true);
      expect(replay.value.appointment.version).toBe(checkedInVersion);
    }

    const again = await checkIn.execute({ appointmentId, expectedVersion: checkedInVersion, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('rejects check-in for the wrong date and for an ended session', async () => {
    const wrongDate = await bookOnSessionA(1);
    clock.set(new Date('2026-08-21T04:00:00Z'));
    const wrongDateResult = await checkIn.execute({ appointmentId: wrongDate.appointmentId, expectedVersion: wrongDate.version, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
    expect(wrongDateResult.ok).toBe(false);
    if (!wrongDateResult.ok) expect(wrongDateResult.error.code).toBe('WRONG_DATE');
    clock.set(new Date('2026-08-20T04:00:00Z'));

    const clinicSessionRepository = new KyselyClinicSessionRepository(db);
    const endedSession = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: SESSION_A_DATE,
      startsAt: new Date('2026-08-20T11:00:00+06:00'),
      endsAt: new Date('2026-08-20T12:00:00+06:00'),
      slotLengthMinutes: 10,
      walkInAllocationPct: 0,
      changeReason: null,
      totalSlotCount: 6,
      bookableSlotCount: 6,
      slots: deriveSlots({ startsAt: new Date('2026-08-20T11:00:00+06:00'), endsAt: new Date('2026-08-20T12:00:00+06:00'), slotLengthMinutes: 10, walkInAllocationPct: 0 }).slots,
      createdBy,
    });
    if (endedSession.outcome !== 'created') throw new Error('setup failed');
    const endedSlotRows = await db.selectFrom('scheduling.session_slot').select('id').where('clinic_session_id', '=', endedSession.session.sessionId).orderBy('slot_index').execute();
    const endedSlotId = endedSlotRows[0]?.id;
    if (endedSlotId === undefined) throw new Error('setup failed');

    const studentId = '01920000-0000-7000-8000-000000082001';
    await db.insertInto('identity.user_account').values({ id: studentId, email: 'transitions-ended-student-test@diu.edu.bd', full_name: 'Ended Student', status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: '221-17-9001', is_enrolled: true }).execute();
    const slotRow = await db.selectFrom('scheduling.session_slot').select('slot_starts_at').where('id', '=', endedSlotId).executeTakeFirstOrThrow();
    const booked = await repository.createBooking({
      slot: {
        slotId: endedSlotId,
        sessionId: endedSession.session.sessionId,
        doctorId,
        doctorName: 'Dr. Transitions',
        locationId,
        sessionDate: SESSION_A_DATE,
        slotStartsAt: slotRow.slot_starts_at,
        sessionStartsAt: new Date('2026-08-20T11:00:00+06:00'),
        isOnlineBookable: true,
      },
      studentId,
      visitReasonCategoryId: null,
      visitReasonNote: null,
      createdBy: studentId,
    });
    if (booked.outcome !== 'created') throw new Error('setup failed');

    await db.updateTable('scheduling.clinic_session').set({ status: 'completed', actually_ended_at: clock.now() }).where('id', '=', endedSession.session.sessionId).execute();

    const result = await checkIn.execute({ appointmentId: booked.appointment.appointmentId, expectedVersion: booked.appointment.version, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_ENDED');
  });

  it('advance: gates unpaid consultation start on a payment override, then advances through to completed', async () => {
    const { appointmentId, version } = await bookOnSessionA(2);
    const checkedIn = await checkIn.execute({ appointmentId, expectedVersion: version, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
    if (!checkedIn.ok) throw new Error('setup failed');

    const toWaiting = await advance.execute({
      appointmentId,
      toStatus: 'waiting',
      paymentOverrideReason: null,
      expectedVersion: checkedIn.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    expect(toWaiting.ok).toBe(true);
    if (!toWaiting.ok) return;
    expect(toWaiting.value.permittedTransitions).toEqual(['in_consultation']);

    const blocked = await advance.execute({
      appointmentId,
      toStatus: 'in_consultation',
      paymentOverrideReason: null,
      expectedVersion: toWaiting.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('PAYMENT_REQUIRED');

    const overridden = await advance.execute({
      appointmentId,
      toStatus: 'in_consultation',
      paymentOverrideReason: 'Paying at the counter after the visit',
      expectedVersion: toWaiting.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    expect(overridden.ok).toBe(true);
    if (!overridden.ok) return;
    expect(overridden.value.paymentOverrideRecorded).toBe(true);
    expect(overridden.value.appointment.consultationStartedAt).not.toBeNull();

    const completed = await advance.execute({
      appointmentId,
      toStatus: 'completed',
      paymentOverrideReason: null,
      expectedVersion: overridden.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.value.appointment.status).toBe('completed');
      expect(completed.value.appointment.consultationCompletedAt).not.toBeNull();
      expect(completed.value.permittedTransitions).toEqual([]);
    }
  });

  it('advance: SESSION_NOT_STARTED when the session is still scheduled', async () => {
    const clinicSessionRepository = new KyselyClinicSessionRepository(db);
    const scheduledSession = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: '2026-08-22',
      startsAt: new Date('2026-08-22T09:00:00+06:00'),
      endsAt: new Date('2026-08-22T10:00:00+06:00'),
      slotLengthMinutes: 10,
      walkInAllocationPct: 0,
      changeReason: null,
      totalSlotCount: 6,
      bookableSlotCount: 6,
      slots: deriveSlots({ startsAt: new Date('2026-08-22T09:00:00+06:00'), endsAt: new Date('2026-08-22T10:00:00+06:00'), slotLengthMinutes: 10, walkInAllocationPct: 0 }).slots,
      createdBy,
    });
    if (scheduledSession.outcome !== 'created') throw new Error('setup failed');
    const slotRows = await db.selectFrom('scheduling.session_slot').select('id').where('clinic_session_id', '=', scheduledSession.session.sessionId).orderBy('slot_index').execute();
    const slotId = slotRows[0]?.id;
    if (slotId === undefined) throw new Error('setup failed');

    const studentId = '01920000-0000-7000-8000-000000082101';
    await db.insertInto('identity.user_account').values({ id: studentId, email: 'transitions-notstarted-student-test@diu.edu.bd', full_name: 'Not Started Student', status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: '221-17-9002', is_enrolled: true }).execute();
    const slotRow = await db.selectFrom('scheduling.session_slot').select('slot_starts_at').where('id', '=', slotId).executeTakeFirstOrThrow();
    const booked = await repository.createBooking({
      slot: {
        slotId,
        sessionId: scheduledSession.session.sessionId,
        doctorId,
        doctorName: 'Dr. Transitions',
        locationId,
        sessionDate: '2026-08-22',
        slotStartsAt: slotRow.slot_starts_at,
        sessionStartsAt: new Date('2026-08-22T09:00:00+06:00'),
        isOnlineBookable: true,
      },
      studentId,
      visitReasonCategoryId: null,
      visitReasonNote: null,
      createdBy: studentId,
    });
    if (booked.outcome !== 'created') throw new Error('setup failed');

    clock.set(new Date('2026-08-22T04:00:00Z'));
    const checkedIn = await checkIn.execute({ appointmentId: booked.appointment.appointmentId, expectedVersion: booked.appointment.version, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
    if (!checkedIn.ok) throw new Error('setup failed');

    const result = await advance.execute({
      appointmentId: booked.appointment.appointmentId,
      toStatus: 'waiting',
      paymentOverrideReason: null,
      expectedVersion: checkedIn.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_NOT_STARTED');
    clock.set(new Date('2026-08-20T04:00:00Z'));
  });

  it('no-show: grace period, rolling suspension at the 3rd occurrence within the window, then a reversal lifts it', async () => {
    async function bookCheckInWaitAndNoShow(slotIndex: number, studentId?: string): Promise<{ readonly appointmentId: string; readonly studentId: string; readonly version: number }> {
      const booking = studentId === undefined ? await bookOnSessionA(slotIndex) : await bookOnSessionAAsStudent(slotIndex, studentId);
      const checkedIn = await checkIn.execute({ appointmentId: booking.appointmentId, expectedVersion: booking.version, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
      if (!checkedIn.ok) throw new Error('setup failed');
      const waiting = await advance.execute({
        appointmentId: booking.appointmentId,
        toStatus: 'waiting',
        paymentOverrideReason: null,
        expectedVersion: checkedIn.value.appointment.version,
        idempotencyKey: null,
        actorId: createdBy,
        correlationId: 'c',
      });
      if (!waiting.ok) throw new Error('setup failed');

      const started = await markNoShow.execute({ appointmentId: booking.appointmentId, reason: null, expectedVersion: waiting.value.appointment.version, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
      expect(started.ok).toBe(false);
      if (!started.ok) {
        expect(started.error.code).toBe('GRACE_PERIOD_NOT_ELAPSED');
        expect(started.error.details?.remainingSeconds).toBe(20 * 60);
      }

      // Starting the grace-period clock is itself a version-bumping UPDATE (the trigger fires on any
      // write), so the retry after the grace period must use the freshly re-fetched version — exactly
      // the re-fetch-before-retry a real staff console would do after seeing GRACE_PERIOD_NOT_ELAPSED.
      const afterClockStart = await repository.findAppointmentDetail(booking.appointmentId);
      if (afterClockStart === null) throw new Error('setup failed');

      clock.advanceMs(20 * 60 * 1000);
      const marked = await markNoShow.execute({
        appointmentId: booking.appointmentId,
        reason: 'Called three times, no response',
        expectedVersion: afterClockStart.version,
        idempotencyKey: null,
        actorId: createdBy,
        correlationId: 'c',
      });
      if (!marked.ok) throw new Error(`markNoShow failed: ${marked.error.code}`);
      return { appointmentId: booking.appointmentId, studentId: booking.studentId, version: marked.value.appointment.version };
    }

    async function bookOnSessionAAsStudent(slotIndex: number, studentId: string): Promise<{ readonly appointmentId: string; readonly studentId: string; readonly version: number }> {
      const slotId = sessionASlots[slotIndex];
      if (slotId === undefined) throw new Error('setup failed: not enough slots');
      const slotRow = await db.selectFrom('scheduling.session_slot').select('slot_starts_at').where('id', '=', slotId).executeTakeFirstOrThrow();
      const outcome = await repository.createBooking({
        slot: {
          slotId,
          sessionId: sessionAId,
          doctorId,
          doctorName: 'Dr. Transitions',
          locationId,
          sessionDate: SESSION_A_DATE,
          slotStartsAt: slotRow.slot_starts_at,
          sessionStartsAt: SESSION_A_START,
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

    const repeatStudentId = '01920000-0000-7000-8000-000000082201';
    await db.insertInto('identity.user_account').values({ id: repeatStudentId, email: 'transitions-repeat-student-test@diu.edu.bd', full_name: 'Repeat No-show Student', status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: repeatStudentId, student_ref: '221-17-9003', is_enrolled: true }).execute();

    const first = await bookCheckInWaitAndNoShow(3, repeatStudentId);
    expect((await suspensionRepository.findActiveSuspensionDetail(repeatStudentId, clock.now()))).toBeNull();
    void first;

    const second = await bookCheckInWaitAndNoShow(4, repeatStudentId);
    expect((await suspensionRepository.findActiveSuspensionDetail(repeatStudentId, clock.now()))).toBeNull();
    void second;

    const third = await bookCheckInWaitAndNoShow(5, repeatStudentId);
    const suspension = await suspensionRepository.findActiveSuspensionDetail(repeatStudentId, clock.now());
    expect(suspension).not.toBeNull();
    expect(suspension?.noShowCount).toBe(3);
    expect(sentNotifications.some((n) => n.recipientId === repeatStudentId && n.templateKey === 'booking_suspended')).toBe(true);

    const reversed = await reverse.execute({
      appointmentId: third.appointmentId,
      toStatus: 'waiting',
      reason: 'Marked no-show by mistake, patient was in the corridor',
      expectedVersion: third.version,
      actorId: createdBy,
      correlationId: 'c',
    });
    expect(reversed.ok).toBe(true);
    if (reversed.ok) {
      expect(reversed.value.reversedFrom).toBe('no_show');
      expect(reversed.value.suspensionRecalculated).toBe(true);
      expect(reversed.value.appointment.status).toBe('waiting');
    }

    const liftedSuspension = await suspensionRepository.findActiveSuspensionDetail(repeatStudentId, clock.now());
    expect(liftedSuspension).toBeNull();

    if (reversed.ok) {
      const invalidTarget = await reverse.execute({
        appointmentId: third.appointmentId,
        toStatus: 'completed',
        reason: 'Trying an invalid reversal target here',
        expectedVersion: reversed.value.appointment.version,
        actorId: createdBy,
        correlationId: 'c',
      });
      expect(invalidTarget.ok).toBe(false);
      if (!invalidTarget.ok) expect(invalidTarget.error.code).toBe('INVALID_REVERSAL_TARGET');

      const tooShortReason = await reverse.execute({
        appointmentId: third.appointmentId,
        toStatus: 'checked_in',
        reason: 'short',
        expectedVersion: reversed.value.appointment.version,
        actorId: createdBy,
        correlationId: 'c',
      });
      expect(tooShortReason.ok).toBe(false);
      if (!tooShortReason.ok) expect(tooShortReason.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('emergency: reorders ahead of waiting patients, notifies once, then throttles a second emergency in the same window', async () => {
    // A dedicated, freshly started session — session A already carries active
    // leftovers from earlier tests in this file (a still-`booked` and a
    // still-`checked_in` entry), which would otherwise inflate `waitingAppointments`.
    const clinicSessionRepository = new KyselyClinicSessionRepository(db);
    const emergencyStartsAt = new Date('2026-08-23T09:00:00+06:00');
    const emergencyEndsAt = new Date('2026-08-23T10:00:00+06:00');
    const emergencySession = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: '2026-08-23',
      startsAt: emergencyStartsAt,
      endsAt: emergencyEndsAt,
      slotLengthMinutes: 10,
      walkInAllocationPct: 0,
      changeReason: null,
      totalSlotCount: 6,
      bookableSlotCount: 6,
      slots: deriveSlots({ startsAt: emergencyStartsAt, endsAt: emergencyEndsAt, slotLengthMinutes: 10, walkInAllocationPct: 0 }).slots,
      createdBy,
    });
    if (emergencySession.outcome !== 'created') throw new Error('setup failed');
    await db.updateTable('scheduling.clinic_session').set({ status: 'started', actually_started_at: clock.now() }).where('id', '=', emergencySession.session.sessionId).execute();
    const emergencySlotRows = await db.selectFrom('scheduling.session_slot').select('id').where('clinic_session_id', '=', emergencySession.session.sessionId).orderBy('slot_index').execute();
    const emergencySlots = emergencySlotRows.map((row) => row.id);

    async function bookOnEmergencySession(slotIndex: number): Promise<{ readonly appointmentId: string; readonly studentId: string; readonly version: number }> {
      counter += 1;
      const suffix = String(counter).padStart(2, '0');
      const studentId = `01920000-0000-7000-8000-0000000083${suffix}`;
      await db.insertInto('identity.user_account').values({ id: studentId, email: `transitions-emergency-student-${suffix}-test@diu.edu.bd`, full_name: `Emergency Student ${suffix}`, status: 'active' }).execute();
      await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: `221-16-93${suffix}`, is_enrolled: true }).execute();
      const slotId = emergencySlots[slotIndex];
      if (slotId === undefined) throw new Error('setup failed: not enough slots');
      const slotRow = await db.selectFrom('scheduling.session_slot').select('slot_starts_at').where('id', '=', slotId).executeTakeFirstOrThrow();
      const outcome = await repository.createBooking({
        slot: {
          slotId,
          sessionId: emergencySession.session.sessionId,
          doctorId,
          doctorName: 'Dr. Transitions',
          locationId,
          sessionDate: '2026-08-23',
          slotStartsAt: slotRow.slot_starts_at,
          sessionStartsAt: emergencyStartsAt,
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

    clock.set(new Date('2026-08-23T04:00:00Z'));

    const waitingPatient = await bookOnEmergencySession(0);
    const waitingCheckedIn = await checkIn.execute({ appointmentId: waitingPatient.appointmentId, expectedVersion: waitingPatient.version, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
    if (!waitingCheckedIn.ok) throw new Error('setup failed');
    const waitingAdvanced = await advance.execute({
      appointmentId: waitingPatient.appointmentId,
      toStatus: 'waiting',
      paymentOverrideReason: null,
      expectedVersion: waitingCheckedIn.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    if (!waitingAdvanced.ok) throw new Error('setup failed');

    const emergencyOne = await bookOnEmergencySession(1);
    const result = await markEmergency.execute({ appointmentId: emergencyOne.appointmentId, reason: 'Severe chest pain and shortness of breath', expectedVersion: emergencyOne.version, actorId: createdBy, correlationId: 'c' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.appointment.isEmergency).toBe(true);
    expect(result.value.position).toBe(1);
    expect(result.value.patientsNotified).toBe(1);
    expect(result.value.notificationSuppressed).toBe(false);
    expect(sentNotifications.some((n) => n.recipientId === waitingPatient.studentId && n.templateKey === 'emergency_inserted')).toBe(true);

    const alreadyEmergency = await markEmergency.execute({ appointmentId: emergencyOne.appointmentId, reason: 'Trying to mark it emergency again', expectedVersion: result.value.appointment.version, actorId: createdBy, correlationId: 'c' });
    expect(alreadyEmergency.ok).toBe(false);
    if (!alreadyEmergency.ok) expect(alreadyEmergency.error.code).toBe('ALREADY_EMERGENCY');

    // Candidates this time are `waitingPatient` (already notified moments ago — throttled) and
    // `emergencyOne` itself (still `booked`, so still an active entry, but never notified before —
    // it gets its first notification now). One notified, one suppressed: `notificationSuppressed`
    // reflects that at least one candidate was held back by EC-12's throttle.
    const sentBeforeSecondEmergency = sentNotifications.length;
    const emergencyTwo = await bookOnEmergencySession(2);
    const throttled = await markEmergency.execute({ appointmentId: emergencyTwo.appointmentId, reason: 'Another emergency arriving shortly after', expectedVersion: emergencyTwo.version, actorId: createdBy, correlationId: 'c' });
    expect(throttled.ok).toBe(true);
    if (throttled.ok) {
      expect(throttled.value.patientsNotified).toBe(1);
      expect(throttled.value.notificationSuppressed).toBe(true);
    }
    const newNotifications = sentNotifications.slice(sentBeforeSecondEmergency);
    expect(newNotifications.some((n) => n.recipientId === waitingPatient.studentId)).toBe(false);
    expect(newNotifications.some((n) => n.recipientId === emergencyOne.studentId)).toBe(true);

    const invalidReason = await markEmergency.execute({ appointmentId: emergencyTwo.appointmentId, reason: 'short', expectedVersion: emergencyTwo.version, actorId: createdBy, correlationId: 'c' });
    expect(invalidReason.ok).toBe(false);
    if (!invalidReason.ok) expect(invalidReason.error.code).toBe('VALIDATION_FAILED');
  });
});
