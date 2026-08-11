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
  RecalculateSessionEstimatesHandler,
  RecordConsultationMetricsHandler,
  seedQueueingPolicies,
  type AppointmentRepository,
} from '../../src/modules/queueing/index.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { FixedClock } from '../support/fixed-clock.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('Estimation + recalculation (M3-G) — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: AppointmentRepository;
  let policyStore: PolicyStore;
  let auditRecorder: AuditRecorder;
  let clock: FixedClock;
  let sentNotifications: { readonly recipientId: string; readonly templateKey: string }[];
  let checkIn: CheckInAppointmentHandler;
  let advance: AdvanceAppointmentHandler;

  let locationId: string;
  let doctorId: string;
  const createdBy = '01920000-0000-7000-8000-000000004a01';
  let counter = 0;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });
    repository = new KyselyAppointmentRepository(db);
    policyStore = new PolicyStore(db);
    await seedQueueingPolicies(policyStore);
    auditRecorder = new AuditRecorder(db);
    clock = new FixedClock(new Date('2026-08-18T03:00:00Z'));

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'estimation-staff-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const doctor = await doctorRepository.createDoctor({ fullName: 'Dr. Estimation', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (doctor.outcome !== 'created') throw new Error('setup failed');
    doctorId = doctor.doctor.doctorId;
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
    const recalculate = new RecalculateSessionEstimatesHandler(repository, policyStore, auditRecorder, notify);
    const recordConsultationMetrics = new RecordConsultationMetricsHandler(repository, auditRecorder);
    checkIn = new CheckInAppointmentHandler(repository, auditRecorder, clock);
    advance = new AdvanceAppointmentHandler(repository, auditRecorder, clock, recalculate, recordConsultationMetrics);
  });

  async function createStartedSession(sessionDate: string, startsAt: Date, endsAt: Date): Promise<{ readonly sessionId: string; readonly slots: readonly string[] }> {
    const clinicSessionRepository = new KyselyClinicSessionRepository(db);
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
    await db.updateTable('scheduling.clinic_session').set({ status: 'started', actually_started_at: clock.now() }).where('id', '=', session.session.sessionId).execute();
    const slotRows = await db.selectFrom('scheduling.session_slot').select('id').where('clinic_session_id', '=', session.session.sessionId).orderBy('slot_index').execute();
    return { sessionId: session.session.sessionId, slots: slotRows.map((row) => row.id) };
  }

  async function bookOnSession(
    sessionId: string,
    slots: readonly string[],
    slotIndex: number,
    sessionDate: string,
    startsAt: Date,
  ): Promise<{ readonly appointmentId: string; readonly studentId: string; readonly version: number }> {
    counter += 1;
    const suffix = String(counter).padStart(2, '0');
    const studentId = `01920000-0000-7000-8000-0000000041${suffix}`;
    await db.insertInto('identity.user_account').values({ id: studentId, email: `estimation-student-${suffix}-test@diu.edu.bd`, full_name: `Student ${suffix}`, status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: `221-19-90${suffix}`, is_enrolled: true }).execute();

    const slotId = slots[slotIndex];
    if (slotId === undefined) throw new Error('setup failed: not enough slots');
    const slotRow = await db.selectFrom('scheduling.session_slot').select('slot_starts_at').where('id', '=', slotId).executeTakeFirstOrThrow();

    const outcome = await repository.createBooking({
      slot: {
        slotId,
        sessionId,
        doctorId,
        doctorName: 'Dr. Estimation',
        locationId,
        sessionDate,
        slotStartsAt: slotRow.slot_starts_at,
        sessionStartsAt: startsAt,
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

  async function runFullConsultation(
    appointmentId: string,
    version: number,
    consultationMinutes: number,
  ): Promise<void> {
    const checkedIn = await checkIn.execute({ appointmentId, expectedVersion: version, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
    if (!checkedIn.ok) throw new Error('setup failed: check-in');
    const waiting = await advance.execute({
      appointmentId,
      toStatus: 'waiting',
      paymentOverrideReason: null,
      expectedVersion: checkedIn.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    if (!waiting.ok) throw new Error('setup failed: advance to waiting');
    const started = await advance.execute({
      appointmentId,
      toStatus: 'in_consultation',
      paymentOverrideReason: 'Paying at the counter later',
      expectedVersion: waiting.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    if (!started.ok) throw new Error('setup failed: advance to in_consultation');

    clock.advanceMs(consultationMinutes * 60 * 1000);
    const completed = await advance.execute({
      appointmentId,
      toStatus: 'completed',
      paymentOverrideReason: null,
      expectedVersion: started.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    if (!completed.ok) throw new Error('setup failed: advance to completed');
  }

  it('establishes the doctor’s 30-day trailing mean, excluding an anomalous duration (EC-15)', async () => {
    // Session X: two completed consultations for this doctor — one normal (15 min,
    // within the 4x/10min=40min anomaly ceiling), one anomalous (60 min, excluded).
    const sessionX = await createStartedSession('2026-08-18', new Date('2026-08-18T09:00:00+06:00'), new Date('2026-08-18T10:00:00+06:00'));

    const normal = await bookOnSession(sessionX.sessionId, sessionX.slots, 0, '2026-08-18', new Date('2026-08-18T09:00:00+06:00'));
    await runFullConsultation(normal.appointmentId, normal.version, 15);

    const anomalous = await bookOnSession(sessionX.sessionId, sessionX.slots, 1, '2026-08-18', new Date('2026-08-18T09:00:00+06:00'));
    await runFullConsultation(anomalous.appointmentId, anomalous.version, 60);

    const rawDurations = await repository.listDoctorTrailingConsultationDurations(doctorId, new Date(clock.now().getTime() - 30 * 24 * 60 * 60 * 1000));
    expect([...rawDurations].sort((a, b) => a - b)).toEqual([15, 60]);

    // Session Y: a fresh session for the same doctor — too few of its own completions
    // (0 < the 3-consultation floor) to use a session-local mean, so recalculation
    // must fall back to the doctor's trailing mean (15, with 60 excluded — not their
    // average of 37.5, and not the 10-minute slot length).
    clock.set(new Date('2026-08-19T03:00:00Z'));
    const sessionY = await createStartedSession('2026-08-19', new Date('2026-08-19T09:00:00+06:00'), new Date('2026-08-19T11:00:00+06:00'));
    const a = await bookOnSession(sessionY.sessionId, sessionY.slots, 0, '2026-08-19', new Date('2026-08-19T09:00:00+06:00'));
    const b = await bookOnSession(sessionY.sessionId, sessionY.slots, 1, '2026-08-19', new Date('2026-08-19T09:00:00+06:00'));
    const c = await bookOnSession(sessionY.sessionId, sessionY.slots, 2, '2026-08-19', new Date('2026-08-19T09:00:00+06:00'));

    const bChecked = await checkIn.execute({ appointmentId: b.appointmentId, expectedVersion: b.version, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
    if (!bChecked.ok) throw new Error('setup failed');
    const bWaiting = await advance.execute({
      appointmentId: b.appointmentId,
      toStatus: 'waiting',
      paymentOverrideReason: null,
      expectedVersion: bChecked.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    if (!bWaiting.ok) throw new Error('setup failed');

    const cChecked = await checkIn.execute({ appointmentId: c.appointmentId, expectedVersion: c.version, idempotencyKey: null, actorId: createdBy, correlationId: 'c' });
    if (!cChecked.ok) throw new Error('setup failed');
    const cWaiting = await advance.execute({
      appointmentId: c.appointmentId,
      toStatus: 'waiting',
      paymentOverrideReason: null,
      expectedVersion: cChecked.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c',
    });
    if (!cWaiting.ok) throw new Error('setup failed');

    // Complete A (never checked in — cancel it instead, since only a booked/checked_in
    // entry may be cancelled, and cancellation is one of FR-APT-21's five triggers).
    const beforeCompletionNow = clock.now();
    const aDetail = await repository.findAppointmentDetail(a.appointmentId);
    if (aDetail === null) throw new Error('setup failed');
    const cancelOutcome = await repository.cancelAppointment(a.appointmentId, aDetail.version, 'cancelled', null, beforeCompletionNow);
    if (cancelOutcome.outcome !== 'cancelled') throw new Error('setup failed');

    // Recalculation isn't wired into a raw repository call — invoke it directly here,
    // exactly as CancelAppointmentHandler would right after that same write.
    const recalc = new RecalculateSessionEstimatesHandler(repository, policyStore, auditRecorder, () => Promise.resolve());
    await recalc.execute(sessionY.sessionId, beforeCompletionNow, 'booking_cancelled', createdBy, 'c');

    const bAfter = await repository.findAppointmentDetail(b.appointmentId);
    const cAfter = await repository.findAppointmentDetail(c.appointmentId);
    if (bAfter === null || cAfter === null) throw new Error('setup failed');

    // B is now first in the active queue (index 0) — estimate is "now".
    expect(bAfter.currentEstimate?.getTime()).toBe(beforeCompletionNow.getTime());
    // C is second (index 1) — estimate is "now" plus one 15-minute mean-duration slot.
    expect(cAfter.currentEstimate?.getTime()).toBe(beforeCompletionNow.getTime() + 15 * 60 * 1000);
  });

  it('notifies a slipped estimate exactly once (BR-20/FR-APT-24) and records a consultation-accuracy sample on start (FR-APT-25/NFR-ACC-01)', async () => {
    clock.set(new Date('2026-08-20T03:00:00Z'));
    const session = await createStartedSession('2026-08-20', new Date('2026-08-20T09:00:00+06:00'), new Date('2026-08-20T10:00:00+06:00'));
    const first = await bookOnSession(session.sessionId, session.slots, 0, '2026-08-20', new Date('2026-08-20T09:00:00+06:00'));
    const second = await bookOnSession(session.sessionId, session.slots, 1, '2026-08-20', new Date('2026-08-20T09:00:00+06:00'));

    const secondBeforeStart = await repository.findAppointmentDetail(second.appointmentId);
    if (secondBeforeStart === null) throw new Error('setup failed');
    const secondEstimateAtBooking = secondBeforeStart.estimateAtBooking;
    if (secondEstimateAtBooking === null) throw new Error('setup failed');

    // Push the clock well past `second`'s original booking-time estimate before
    // completing `first` — however small the mean duration, `second`'s recalculated
    // estimate ("now" plus one slot, since it becomes the sole remaining active
    // entry) will land far more than 30 minutes after what it was told at booking.
    clock.set(new Date(secondEstimateAtBooking.getTime() + 45 * 60 * 1000));

    const firstChecked = await checkIn.execute({ appointmentId: first.appointmentId, expectedVersion: first.version, idempotencyKey: null, actorId: createdBy, correlationId: 'c1' });
    if (!firstChecked.ok) throw new Error('setup failed');
    const firstWaiting = await advance.execute({
      appointmentId: first.appointmentId,
      toStatus: 'waiting',
      paymentOverrideReason: null,
      expectedVersion: firstChecked.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c1',
    });
    if (!firstWaiting.ok) throw new Error('setup failed');

    const predictedAtStart = firstWaiting.value.appointment.currentEstimate;
    if (predictedAtStart === null) throw new Error('setup failed');
    const consultationStartedAt = clock.now();

    const firstStarted = await advance.execute({
      appointmentId: first.appointmentId,
      toStatus: 'in_consultation',
      paymentOverrideReason: 'Paying at the counter later, thanks',
      expectedVersion: firstWaiting.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c1',
    });
    if (!firstStarted.ok) throw new Error('setup failed');

    // FR-APT-25/NFR-ACC-01: the accuracy sample is written the moment the
    // consultation starts, not when it completes.
    const sample = await db
      .selectFrom('queueing.estimate_accuracy_sample')
      .selectAll()
      .where('appointment_id', '=', first.appointmentId)
      .executeTakeFirst();
    expect(sample).toBeDefined();
    expect(sample?.doctor_id).toBe(doctorId);
    expect(sample?.predicted_at.getTime()).toBe(predictedAtStart.getTime());
    expect(sample?.actual_started_at.getTime()).toBe(consultationStartedAt.getTime());
    expect(sample?.deviation_minutes).toBe(Math.round((consultationStartedAt.getTime() - predictedAtStart.getTime()) / 60_000));

    clock.advanceMs(5 * 60 * 1000);
    const firstCompleted = await advance.execute({
      appointmentId: first.appointmentId,
      toStatus: 'completed',
      paymentOverrideReason: null,
      expectedVersion: firstStarted.value.appointment.version,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c2',
    });
    expect(firstCompleted.ok).toBe(true);

    expect(sentNotifications.filter((n) => n.recipientId === second.studentId && n.templateKey === 'estimate_slipped')).toHaveLength(1);

    const secondRow = await db.selectFrom('queueing.appointment').select('last_slip_notified_at').where('id', '=', second.appointmentId).executeTakeFirstOrThrow();
    expect(secondRow.last_slip_notified_at).not.toBeNull();

    // A second recalculation-triggering event (cancelling `second` itself is no
    // longer meaningful here; instead assert no further notification fires by
    // re-running recalculation directly) must not re-notify — the throttle is a
    // single "already told them" marker, not a re-arming one.
    const recalcAgain = new RecalculateSessionEstimatesHandler(
      repository,
      policyStore,
      auditRecorder,
      (input) => {
        sentNotifications.push({ recipientId: input.recipientId, templateKey: input.templateKey });
        return Promise.resolve();
      },
    );
    clock.advanceMs(60 * 60 * 1000);
    await recalcAgain.execute(session.sessionId, clock.now(), 'no_show', createdBy, 'c3');
    expect(sentNotifications.filter((n) => n.recipientId === second.studentId && n.templateKey === 'estimate_slipped')).toHaveLength(1);
  });
});
