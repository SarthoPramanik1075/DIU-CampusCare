import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import type { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import type { Clock } from '../../src/kernel/clock/clock.js';
import { ConfirmUnavailabilityHandler, deriveSlots, KyselyClinicSessionRepository, KyselyDoctorRepository, KyselyUnavailabilityRepository } from '../../src/modules/scheduling/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('KyselyUnavailabilityRepository — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let repository: KyselyUnavailabilityRepository;
  let doctorId: string;
  let locationId: string;
  const createdBy = '01920000-0000-7000-8000-000000006a01';
  let counter = 0;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    repository = new KyselyUnavailabilityRepository(db);

    locationId = (await db.selectFrom('config.location').select('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('identity.user_account').values({ id: createdBy, email: 'unavailability-admin-test@diu.edu.bd', full_name: 'DIU Medical Staff', status: 'active' }).execute();

    const doctorRepository = new KyselyDoctorRepository(db);
    const created = await doctorRepository.createDoctor({ fullName: 'Dr. Unavailability', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (created.outcome !== 'created') throw new Error('setup failed');
    doctorId = created.doctor.doctorId;
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  async function createSessionWithBookedAppointment(sessionDate: string, paymentStatus: 'unpaid' | 'paid'): Promise<{ readonly sessionId: string; readonly appointmentId: string; readonly studentId: string }> {
    counter += 1;
    const suffix = String(counter).padStart(2, '0');
    const sessionRepository = new KyselyClinicSessionRepository(db);
    const startsAt = new Date(`${sessionDate}T09:00:00+06:00`);
    const endsAt = new Date(`${sessionDate}T13:00:00+06:00`);
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 30 });
    const created = await sessionRepository.createClinicSession({
      doctorId,
      locationId,
      dutyRosterId: null,
      sessionDate,
      startsAt,
      endsAt,
      slotLengthMinutes: 10,
      walkInAllocationPct: 30,
      changeReason: null,
      totalSlotCount: derived.totalSlotCount,
      bookableSlotCount: derived.bookableSlotCount,
      slots: derived.slots,
      createdBy,
    });
    if (created.outcome !== 'created') throw new Error('setup failed');

    const studentId = `01920000-0000-7000-8000-0000000061${suffix}`;
    await db.insertInto('identity.user_account').values({ id: studentId, email: `unavailability-student-${suffix}-test@diu.edu.bd`, full_name: 'A Student', status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: `221-15-91${suffix}`, is_enrolled: true }).execute();

    const slots = await sessionRepository.listSessionSlots(created.session.sessionId);
    const firstSlot = slots[0];
    if (firstSlot === undefined) throw new Error('setup failed');

    const appointmentId = `01920000-0000-7000-8000-0000000062${suffix}`;
    await db
      .insertInto('queueing.appointment')
      .values({
        id: appointmentId,
        appointment_ref: `MED-2026-UA${suffix}`,
        clinic_session_id: created.session.sessionId,
        session_slot_id: firstSlot.slotId,
        student_id: studentId,
        serial_number: 1,
        origin: 'booked',
        status: 'booked',
        payment_status: paymentStatus,
        created_by: createdBy,
      })
      .execute();

    return { sessionId: created.session.sessionId, appointmentId, studentId };
  }

  it('computeImpact / createPreview / findPreview: a real round trip that writes no unavailability row', async () => {
    const { appointmentId, studentId } = await createSessionWithBookedAppointment('2026-08-20', 'paid');

    const impact = await repository.computeImpact(doctorId, '2026-08-20', '2026-08-24');
    expect(impact.affectedSessions).toBe(1);
    expect(impact.affectedAppointments).toEqual([
      expect.objectContaining({ appointmentId, studentId, studentRef: expect.stringMatching(/^221-15-91/), requiresRefundFlag: true, paymentStatus: 'paid' }),
    ]);

    const beforePreview = await db.selectFrom('scheduling.doctor_unavailability').select('id').where('doctor_id', '=', doctorId).execute();
    expect(beforePreview).toHaveLength(0);

    const { previewToken } = await repository.createPreview(doctorId, '2026-08-20', '2026-08-24', 'Annual leave approved by the medical director', [appointmentId], new Date(Date.now() + 15 * 60 * 1000));

    const afterPreview = await db.selectFrom('scheduling.doctor_unavailability').select('id').where('doctor_id', '=', doctorId).execute();
    expect(afterPreview).toHaveLength(0); // preview alone changes nothing

    const preview = await repository.findPreview(previewToken, doctorId);
    expect(preview).toEqual(expect.objectContaining({ startDate: '2026-08-20', endDate: '2026-08-24', affectedAppointmentIds: [appointmentId] }));

    expect(await repository.findPreview(previewToken, '01920000-0000-7000-8000-0000000000ff')).toBeNull();
    expect(await repository.findPreview('01920000-0000-7000-8000-0000000000ff', doctorId)).toBeNull();
  });

  it('createUnavailability: cancels the affected appointment, records the leave period, detects overlap on a second attempt', async () => {
    const { sessionId, appointmentId, studentId } = await createSessionWithBookedAppointment('2026-09-01', 'unpaid');

    const noOverlapYet = await repository.findOverlappingUnavailability(doctorId, '2026-09-01', '2026-09-03');
    expect(noOverlapYet).toBeNull();

    const created = await repository.createUnavailability(doctorId, '2026-09-01', '2026-09-03', 'Annual leave approved by the medical director', [appointmentId], createdBy);
    expect(created.outcome).toBe('created');
    if (created.outcome === 'created') {
      expect(created.cancelledAppointmentIds).toEqual([appointmentId]);
    }

    const appointmentRow = await db.selectFrom('queueing.appointment').select(['status', 'cancellation_reason']).where('id', '=', appointmentId).executeTakeFirstOrThrow();
    expect(appointmentRow).toEqual({ status: 'cancelled', cancellation_reason: 'Doctor Unavailable' });

    const unavailabilityId = created.outcome === 'created' ? created.unavailabilityId : '';
    const record = await repository.findUnavailabilityById(unavailabilityId);
    expect(record).toEqual(expect.objectContaining({ doctorId, startDate: '2026-09-01', endDate: '2026-09-03', reason: 'Annual leave approved by the medical director' }));

    // Overlapping period — same doctor, intersecting range.
    const overlapping = await repository.createUnavailability(doctorId, '2026-09-02', '2026-09-05', 'Trying again', [], createdBy);
    expect(overlapping.outcome).toBe('overlap');

    // Non-overlapping period is still fine.
    const nonOverlapping = await repository.createUnavailability(doctorId, '2026-09-10', '2026-09-12', 'A different, later leave period', [], createdBy);
    expect(nonOverlapping.outcome).toBe('created');

    void sessionId;
    void studentId;
  });

  it('IMPACT_CHANGED: a booking added between preview and confirm is caught by the real handler against real Postgres', async () => {
    const doctorRepository = new KyselyDoctorRepository(db);
    const raceDoctor = await doctorRepository.createDoctor({ fullName: 'Dr. Impact', designation: null, specialisation: null, photoUrl: null, userAccountId: null, locationId });
    if (raceDoctor.outcome !== 'created') throw new Error('setup failed');
    const raceDoctorId = raceDoctor.doctor.doctorId;

    const sessionRepository = new KyselyClinicSessionRepository(db);
    const startsAt = new Date('2026-10-01T09:00:00+06:00');
    const endsAt = new Date('2026-10-01T13:00:00+06:00');
    const derived = deriveSlots({ startsAt, endsAt, slotLengthMinutes: 10, walkInAllocationPct: 30 });
    const created = await sessionRepository.createClinicSession({
      doctorId: raceDoctorId,
      locationId,
      dutyRosterId: null,
      sessionDate: '2026-10-01',
      startsAt,
      endsAt,
      slotLengthMinutes: 10,
      walkInAllocationPct: 30,
      changeReason: null,
      totalSlotCount: derived.totalSlotCount,
      bookableSlotCount: derived.bookableSlotCount,
      slots: derived.slots,
      createdBy,
    });
    if (created.outcome !== 'created') throw new Error('setup failed');

    // Preview taken while the session has zero bookings.
    const { previewToken } = await repository.createPreview(raceDoctorId, '2026-10-01', '2026-10-03', 'Annual leave approved by the medical director', [], new Date(Date.now() + 15 * 60 * 1000));

    // Someone books while the preview is being reviewed.
    const studentId = '01920000-0000-7000-8000-000000006a99';
    await db.insertInto('identity.user_account').values({ id: studentId, email: 'unavailability-race-student-test@diu.edu.bd', full_name: 'A Student', status: 'active' }).execute();
    await db.insertInto('identity.student_profile').values({ user_account_id: studentId, student_ref: '221-15-9299', is_enrolled: true }).execute();
    const slots = await sessionRepository.listSessionSlots(created.session.sessionId);
    const firstSlot = slots[0];
    if (firstSlot === undefined) throw new Error('setup failed');
    await db
      .insertInto('queueing.appointment')
      .values({
        id: '01920000-0000-7000-8000-000000006a98',
        appointment_ref: 'MED-2026-RACE',
        clinic_session_id: created.session.sessionId,
        session_slot_id: firstSlot.slotId,
        student_id: studentId,
        serial_number: 1,
        origin: 'booked',
        status: 'booked',
        created_by: createdBy,
      })
      .execute();

    const clock: Clock = { now: () => new Date() };
    const auditRecorder = { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditRecorder;
    const enqueueNotification = vi.fn().mockResolvedValue(undefined);
    const handler = new ConfirmUnavailabilityHandler(repository, auditRecorder, clock, enqueueNotification);

    const result = await handler.execute({
      doctorId: raceDoctorId,
      previewToken,
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      reason: 'Annual leave approved by the medical director',
      actorId: createdBy,
      correlationId: 'corr-race',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('IMPACT_CHANGED');
      expect(result.error.details).toEqual({ newAffectedCount: 1 });
    }

    // No unavailability row and no cancellation — the confirm was refused, not partially applied.
    const unavailabilityRows = await db.selectFrom('scheduling.doctor_unavailability').select('id').where('doctor_id', '=', raceDoctorId).execute();
    expect(unavailabilityRows).toHaveLength(0);
    const appointmentRow = await db.selectFrom('queueing.appointment').select('status').where('clinic_session_id', '=', created.session.sessionId).executeTakeFirstOrThrow();
    expect(appointmentRow.status).toBe('booked');
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it('deleteUnavailability: real round trip, not_found for an unknown id', async () => {
    const created = await repository.createUnavailability(doctorId, '2026-11-01', '2026-11-03', 'A future leave period to be withdrawn', [], createdBy);
    if (created.outcome !== 'created') throw new Error('setup failed');

    expect(await repository.findUnavailabilityById(created.unavailabilityId)).not.toBeNull();
    expect(await repository.deleteUnavailability(created.unavailabilityId)).toBe('deleted');
    expect(await repository.findUnavailabilityById(created.unavailabilityId)).toBeNull();
    expect(await repository.deleteUnavailability('01920000-0000-7000-8000-0000000000ff')).toBe('not_found');
  });
});
