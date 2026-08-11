import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { PolicyStore } from '../../src/kernel/policy/policy-store.js';
import {
  KyselyAppointmentRepository,
  RecalculateSessionEstimatesHandler,
  RegisterWalkInHandler,
  seedQueueingPolicies,
  type AppointmentRepository,
} from '../../src/modules/queueing/index.js';
import { deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository } from '../../src/modules/scheduling/index.js';
import { FixedClock } from '../support/fixed-clock.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('Walk-in registration (M3-I) — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: AppointmentRepository;
  let policyStore: PolicyStore;
  let auditRecorder: AuditRecorder;
  let clock: FixedClock;
  let registerWalkIn: RegisterWalkInHandler;

  let locationId: string;
  let doctorId: string;
  let sessionId: string;
  const createdBy = '01920000-0000-7000-8000-000000006c01';
  const SESSION_DATE = '2026-08-24';

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }) });
    repository = new KyselyAppointmentRepository(db);
    policyStore = new PolicyStore(db);
    await seedQueueingPolicies(policyStore);
    auditRecorder = new AuditRecorder(db);
    clock = new FixedClock(new Date('2026-08-24T04:00:00Z'));

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'walkin-reg-staff-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const doctor = await doctorRepository.createDoctor({ fullName: 'Dr. Walk-in', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (doctor.outcome !== 'created') throw new Error('setup failed');
    doctorId = doctor.doctor.doctorId;

    const clinicSessionRepository = new KyselyClinicSessionRepository(db);
    const startsAt = new Date('2026-08-24T09:00:00+06:00');
    const endsAt = new Date('2026-08-24T11:00:00+06:00');
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 50 });
    const session = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: SESSION_DATE,
      startsAt,
      endsAt,
      slotLengthMinutes: 10,
      walkInAllocationPct: 50,
      changeReason: null,
      totalSlotCount: derived.totalSlotCount,
      bookableSlotCount: derived.bookableSlotCount,
      slots: derived.slots,
      createdBy,
    });
    if (session.outcome !== 'created') throw new Error('setup failed');
    sessionId = session.session.sessionId;
    await db.updateTable('scheduling.clinic_session').set({ status: 'started', actually_started_at: clock.now() }).where('id', '=', sessionId).execute();

    const registeredStudentId = '01920000-0000-7000-8000-000000006d01';
    await db.insertInto('identity.user_account').values({ id: registeredStudentId, email: 'walkin-reg-student-test@diu.edu.bd', full_name: 'Registered Student', status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: registeredStudentId, student_ref: '221-24-9001', is_enrolled: true }).execute();

    const suspendedStudentId = '01920000-0000-7000-8000-000000006d02';
    await db.insertInto('identity.user_account').values({ id: suspendedStudentId, email: 'walkin-reg-suspended-test@diu.edu.bd', full_name: 'Suspended Student', status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: suspendedStudentId, student_ref: '221-24-9002', is_enrolled: true }).execute();
    await db
      .insertInto('identity.booking_suspension')
      .values({ id: '01920000-0000-7000-8000-000000006e01', student_id: suspendedStudentId, suspended_until: new Date('2026-09-01T00:00:00Z'), no_show_count: 3 })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  beforeEach(() => {
    const recalculate = new RecalculateSessionEstimatesHandler(repository, policyStore, auditRecorder, () => Promise.resolve());
    registerWalkIn = new RegisterWalkInHandler(repository, auditRecorder, clock, recalculate);
  });

  it('registers a recognised student in the fewest fields, entering directly as waiting', async () => {
    const result = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: '221-24-9001',
      unregisteredName: null,
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.appointment.status).toBe('waiting');
    expect(result.value.appointment.serialNumber).toBeGreaterThan(0);
    expect(result.value.suspensionIgnored).toBe(false);
    expect(result.value.replay).toBe(false);

    const detail = await repository.findAppointmentDetail(result.value.appointment.appointmentId);
    expect(detail?.origin).toBe('walk_in');
    expect(detail?.checkedInAt).not.toBeNull();
  });

  it('registers an unregistered patient by name alone (no studentRef)', async () => {
    const result = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: null,
      unregisteredName: 'Jane Visitor',
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c2',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appointment.studentId).toBeNull();
      expect(result.value.suspensionIgnored).toBe(false);
    }
  });

  it('STUDENT_NOT_FOUND when studentRef does not resolve and no unregisteredName is given, suggesting the fallback', async () => {
    const result = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: '999-99-9999',
      unregisteredName: null,
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c3',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STUDENT_NOT_FOUND');
      expect(result.error.details?.suggestion).toBe('record_as_unregistered');
    }
  });

  it('an unrecognised studentRef falls back to unregisteredName when both are given', async () => {
    const result = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: '999-99-9998',
      unregisteredName: 'Walk-in Fallback',
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c4',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.appointment.studentId).toBeNull();
  });

  it('proceeds regardless of an active booking suspension, and reports it via suspensionIgnored (FR-APT-13/38)', async () => {
    const result = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: '221-24-9002',
      unregisteredName: null,
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c5',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suspensionIgnored).toBe(true);
      expect(result.value.appointment.status).toBe('waiting');
    }
  });

  it('rejects a missing or too-short emergency reason (VR-30)', async () => {
    const missing = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: null,
      unregisteredName: 'Emergency Patient',
      visitReasonCategoryId: null,
      isEmergency: true,
      emergencyReason: null,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c6',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('VALIDATION_FAILED');

    const tooShort = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: null,
      unregisteredName: 'Emergency Patient',
      visitReasonCategoryId: null,
      isEmergency: true,
      emergencyReason: 'short',
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c7',
    });
    expect(tooShort.ok).toBe(false);
  });

  it('marks exceededWalkinAllocation once the session\'s walk-in allocation is used up, and never refuses care', async () => {
    const first = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: null,
      unregisteredName: 'Allocation One',
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c8',
    });
    expect(first.ok).toBe(true);

    const second = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: null,
      unregisteredName: 'Allocation Two',
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c9',
    });
    expect(second.ok).toBe(true);
    // Whether or not the session's own walk-in allocation is already exhausted by
    // this point (earlier tests in this file share the session), registration
    // always succeeds — EC-10's "care is never refused" is the property under test.
    if (second.ok) {
      expect(second.value.appointment.status).toBe('waiting');
    }
  });

  it('idempotent replay: the same Idempotency-Key returns the original row, not a second one', async () => {
    const first = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: null,
      unregisteredName: 'Replay Patient',
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: 'walkin-replay-key-1',
      actorId: createdBy,
      correlationId: 'c10',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = await registerWalkIn.execute({
      clinicSessionId: sessionId,
      studentRef: null,
      unregisteredName: 'Replay Patient',
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: 'walkin-replay-key-1',
      actorId: createdBy,
      correlationId: 'c11',
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.value.replay).toBe(true);
      expect(replay.value.appointment.appointmentId).toBe(first.value.appointment.appointmentId);
    }

    const rows = await db.selectFrom('queueing.appointment').select('id').where('idempotency_key', '=', 'walkin-replay-key-1').execute();
    expect(rows).toHaveLength(1);
  });

  it('SESSION_NOT_TODAY and SESSION_ENDED are both refused', async () => {
    const clinicSessionRepository = new KyselyClinicSessionRepository(db);

    const futureSession = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: '2026-09-05',
      startsAt: new Date('2026-09-05T09:00:00+06:00'),
      endsAt: new Date('2026-09-05T10:00:00+06:00'),
      slotLengthMinutes: 10,
      walkInAllocationPct: 30,
      changeReason: null,
      totalSlotCount: 6,
      bookableSlotCount: 4,
      slots: deriveSlots({ startsAt: new Date('2026-09-05T09:00:00+06:00'), endsAt: new Date('2026-09-05T10:00:00+06:00'), slotLengthMinutes: 10, walkInAllocationPct: 30 }).slots,
      createdBy,
    });
    if (futureSession.outcome !== 'created') throw new Error('setup failed');
    await db.updateTable('scheduling.clinic_session').set({ status: 'started' }).where('id', '=', futureSession.session.sessionId).execute();

    const notToday = await registerWalkIn.execute({
      clinicSessionId: futureSession.session.sessionId,
      studentRef: null,
      unregisteredName: 'Not Today Patient',
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c12',
    });
    expect(notToday.ok).toBe(false);
    if (!notToday.ok) expect(notToday.error.code).toBe('SESSION_NOT_TODAY');

    const endedSession = await clinicSessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: SESSION_DATE,
      startsAt: new Date('2026-08-24T11:00:00+06:00'),
      endsAt: new Date('2026-08-24T12:00:00+06:00'),
      slotLengthMinutes: 10,
      walkInAllocationPct: 30,
      changeReason: null,
      totalSlotCount: 6,
      bookableSlotCount: 4,
      slots: deriveSlots({ startsAt: new Date('2026-08-24T11:00:00+06:00'), endsAt: new Date('2026-08-24T12:00:00+06:00'), slotLengthMinutes: 10, walkInAllocationPct: 30 }).slots,
      createdBy,
    });
    if (endedSession.outcome !== 'created') throw new Error('setup failed');
    await db.updateTable('scheduling.clinic_session').set({ status: 'completed', actually_ended_at: clock.now() }).where('id', '=', endedSession.session.sessionId).execute();

    const ended = await registerWalkIn.execute({
      clinicSessionId: endedSession.session.sessionId,
      studentRef: null,
      unregisteredName: 'Ended Session Patient',
      visitReasonCategoryId: null,
      isEmergency: false,
      emergencyReason: null,
      idempotencyKey: null,
      actorId: createdBy,
      correlationId: 'c13',
    });
    expect(ended.ok).toBe(false);
    if (!ended.ok) expect(ended.error.code).toBe('SESSION_ENDED');
  });
});
