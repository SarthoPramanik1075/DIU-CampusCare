import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createScratchDatabase, expectRejection, type ScratchDatabase } from '../support/scratch-database.js';

/**
 * The core schema's invariants, asserted against real PostgreSQL.
 *
 * These are not tests of application code. They are tests that the
 * *database* refuses what the SRS says must be refused — because that is
 * where DATABASE.md deliberately put the enforcement. If one of these fails,
 * the corresponding application-level check is not a fallback: it is the
 * only thing standing between the system and a corrupt queue.
 */
describe('core schema invariants', () => {
  let db: ScratchDatabase;

  /** Reference rows the invariant tests hang off. */
  const ids = {
    location: '01920000-0000-7000-8000-000000000001',
    admin: '01920000-0000-7000-8000-000000000002',
    doctor: '01920000-0000-7000-8000-000000000003',
    student: '01920000-0000-7000-8000-000000000004',
    session: '01920000-0000-7000-8000-000000000005',
    slot: '01920000-0000-7000-8000-000000000006',
    medicine: '01920000-0000-7000-8000-000000000007',
  };

  beforeAll(async () => {
    db = await createScratchDatabase('core');
    const q = db.client.query.bind(db.client);

    await q(`INSERT INTO config.location (id, code, name) VALUES ($1,'MAIN','Main Medical Center')`, [
      ids.location,
    ]);
    await q(
      `INSERT INTO identity.user_account (id, email, full_name, status, location_id)
       VALUES ($1,'admin@diu.edu.bd','DIU IT','active',$2)`,
      [ids.admin, ids.location],
    );
    await q(
      `INSERT INTO identity.user_account (id, email, full_name, status, location_id)
       VALUES ($1,'student@diu.edu.bd','Nusrat Jahan','active',$2)`,
      [ids.student, ids.location],
    );
    await q(`INSERT INTO identity.student_profile (user_account_id, student_ref) VALUES ($1,'221-15-5678')`, [
      ids.student,
    ]);
    await q(
      `INSERT INTO scheduling.doctor (id, full_name, location_id) VALUES ($1,'Dr. Rahman',$2)`,
      [ids.doctor, ids.location],
    );
    await q(
      `INSERT INTO scheduling.clinic_session
         (id, doctor_id, location_id, session_date, starts_at, ends_at,
          slot_length_minutes, walk_in_allocation_pct, total_slot_count,
          bookable_slot_count, created_by)
       VALUES ($1,$2,$3,'2026-08-04',
               '2026-08-04 09:00+06','2026-08-04 13:00+06',
               10, 30, 24, 17, $4)`,
      [ids.session, ids.doctor, ids.location, ids.admin],
    );
    await q(
      `INSERT INTO scheduling.session_slot (id, clinic_session_id, slot_index, slot_starts_at, is_online_bookable)
       VALUES ($1,$2,0,'2026-08-04 09:00+06',true)`,
      [ids.slot, ids.session],
    );
    await q(
      `INSERT INTO pharmacy.medicine (id, generic_name, strength, dosage_form, dispensing_class, low_stock_threshold, created_by)
       VALUES ($1,'Paracetamol','500 mg','Tablet','otc',50,$2)`,
      [ids.medicine, ids.admin],
    );
  }, 60_000);

  afterAll(async () => {
    await db.drop();
  });

  // -------------------------------------------------------------------
  // VR-19 — no two sessions for one doctor may overlap.
  // A GiST EXCLUDE constraint is race-free; a check-then-insert is not.
  // -------------------------------------------------------------------
  describe('VR-19 · overlapping sessions (ex_session_no_overlap)', () => {
    it('refuses an overlapping session for the same doctor', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO scheduling.clinic_session
             (id, doctor_id, location_id, session_date, starts_at, ends_at,
              slot_length_minutes, walk_in_allocation_pct, total_slot_count,
              bookable_slot_count, created_by)
           VALUES (gen_random_uuid(),$1,$2,'2026-08-04',
                   '2026-08-04 12:00+06','2026-08-04 15:00+06',
                   10,30,18,13,$3)`,
          [ids.doctor, ids.location, ids.admin],
        ),
      );
      expect(state).toBe('23P01'); // exclusion_violation
    });

    it('permits an adjacent session — the range is half-open [)', async () => {
      await expect(
        db.client.query(
          `INSERT INTO scheduling.clinic_session
             (id, doctor_id, location_id, session_date, starts_at, ends_at,
              slot_length_minutes, walk_in_allocation_pct, total_slot_count,
              bookable_slot_count, created_by)
           VALUES (gen_random_uuid(),$1,$2,'2026-08-04',
                   '2026-08-04 13:00+06','2026-08-04 15:00+06',
                   10,30,12,8,$3)`,
          [ids.doctor, ids.location, ids.admin],
        ),
      ).resolves.toBeDefined();
    });

    it('permits an overlapping session once the first is cancelled', async () => {
      const { rows } = await db.client.query<{ id: string }>(
        `INSERT INTO scheduling.clinic_session
           (id, doctor_id, location_id, session_date, starts_at, ends_at,
            slot_length_minutes, walk_in_allocation_pct, total_slot_count,
            bookable_slot_count, created_by, status)
         VALUES (gen_random_uuid(),$1,$2,'2026-08-05',
                 '2026-08-05 09:00+06','2026-08-05 11:00+06',
                 10,30,12,8,$3,'cancelled')
         RETURNING id`,
        [ids.doctor, ids.location, ids.admin],
      );
      expect(rows).toHaveLength(1);

      // The constraint is WHERE (status <> 'cancelled'), so a cancelled
      // session leaves the exclusion set and its slot is reusable.
      await expect(
        db.client.query(
          `INSERT INTO scheduling.clinic_session
             (id, doctor_id, location_id, session_date, starts_at, ends_at,
              slot_length_minutes, walk_in_allocation_pct, total_slot_count,
              bookable_slot_count, created_by)
           VALUES (gen_random_uuid(),$1,$2,'2026-08-05',
                   '2026-08-05 09:00+06','2026-08-05 11:00+06',
                   10,30,12,8,$3)`,
          [ids.doctor, ids.location, ids.admin],
        ),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------
  // EC-01 — exactly one winner for a contested slot.
  // -------------------------------------------------------------------
  describe('EC-01 · slot contention (uq_appointment_slot_active)', () => {
    const first = '01920000-0000-7000-8000-00000000000a';

    it('accepts the first booking for a slot', async () => {
      await expect(
        db.client.query(
          `INSERT INTO queueing.appointment
             (id, appointment_ref, clinic_session_id, session_slot_id, student_id,
              serial_number, origin, created_by)
           VALUES ($1,'MED-2026-0001',$2,$3,$4,1,'booked',$5)`,
          [first, ids.session, ids.slot, ids.student, ids.admin],
        ),
      ).resolves.toBeDefined();
    });

    it('refuses a second active booking for the same slot', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO queueing.appointment
             (id, appointment_ref, clinic_session_id, session_slot_id, unregistered_name,
              serial_number, origin, created_by)
           VALUES (gen_random_uuid(),'MED-2026-0002',$1,$2,'Someone Else',2,'booked',$3)`,
          [ids.session, ids.slot, ids.admin],
        ),
      );
      expect(state).toBe('23505'); // unique_violation
    });

    it('releases the slot on cancellation, with no cleanup step (BR-21)', async () => {
      await db.client.query(
        `UPDATE queueing.appointment SET status='cancelled', version=version WHERE id=$1`,
        [first],
      );
      await expect(
        db.client.query(
          `INSERT INTO queueing.appointment
             (id, appointment_ref, clinic_session_id, session_slot_id, unregistered_name,
              serial_number, origin, created_by)
           VALUES (gen_random_uuid(),'MED-2026-0003',$1,$2,'Rebooked Student',3,'booked',$3)`,
          [ids.session, ids.slot, ids.admin],
        ),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------
  // EC-09 / D4 — one gap-free serial sequence per session, shared by
  // booked patients and walk-ins.
  // -------------------------------------------------------------------
  describe('EC-09 · serial allocation (fn_next_serial)', () => {
    it('issues a contiguous sequence with no gaps or duplicates', async () => {
      const { rows } = await db.client.query<{ serial: number }>(
        `SELECT queueing.fn_next_serial($1) AS serial FROM generate_series(1,20)`,
        [ids.session],
      );
      // fn_next_serial returns int4, which node-postgres decodes as a number.
      const serials = rows.map((r) => r.serial);
      expect(serials).toHaveLength(20);
      expect(new Set(serials).size).toBe(20);
      // Contiguous: max - min + 1 equals the count.
      expect(Math.max(...serials) - Math.min(...serials) + 1).toBe(20);
    });

    it('refuses to allocate against a session that does not exist (BR-25)', async () => {
      const state = await expectRejection(() =>
        db.client.query(`SELECT queueing.fn_next_serial('01920000-0000-7000-8000-0000000000ff')`),
      );
      expect(state).toBe('23503'); // foreign_key_violation
    });
  });

  // -------------------------------------------------------------------
  // VR-92 — a stale write is rejected, never merged (EC-19).
  // -------------------------------------------------------------------
  describe('VR-92 · optimistic concurrency (fn_bump_version)', () => {
    it('increments the version on a write that echoes the current version', async () => {
      const { rows } = await db.client.query<{ version: number }>(
        `UPDATE scheduling.clinic_session SET change_reason='Doctor delayed', version=version
          WHERE id=$1 RETURNING version`,
        [ids.session],
      );
      expect(Number(rows[0]?.version)).toBeGreaterThan(1);
    });

    it('refuses a write that echoes a stale version', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `UPDATE scheduling.clinic_session SET change_reason='Stale write', version=1 WHERE id=$1`,
          [ids.session],
        ),
      );
      expect(state).toBe('40001'); // serialization_failure
    });
  });

  // -------------------------------------------------------------------
  // BR-61 / FR-PAY-10 / FR-MED-21 — append-only tables.
  // Enforced twice: by REVOKE and by trigger, because a future GRANT
  // could undo the first.
  // -------------------------------------------------------------------
  describe('append-only enforcement (fn_forbid_mutation)', () => {
    it.each([
      ['audit.audit_log', `INSERT INTO audit.audit_log (id, entity_type, action) VALUES (gen_random_uuid(),'test','created')`],
      ['audit.authz_denial', `INSERT INTO audit.authz_denial (id, resource, operation, reason) VALUES (gen_random_uuid(),'x','read','denied')`],
    ])('refuses UPDATE and DELETE on %s', async (table, insert) => {
      await db.client.query(insert);

      const updateState = await expectRejection(() =>
        db.client.query(`UPDATE ${table} SET id = id`),
      );
      // ERRCODE 'restrict_violation' is SQLSTATE 23001, not 2F004 — the
      // latter is prohibited_sql_statement_attempted, a different class.
      expect(updateState).toBe('23001');

      const deleteState = await expectRejection(() => db.client.query(`DELETE FROM ${table}`));
      expect(deleteState).toBe('23001');
    });
  });

  // -------------------------------------------------------------------
  // Pharmacy: the two safety-critical rules. Neither can be a CHECK,
  // because both need current_date, which is not immutable.
  // -------------------------------------------------------------------
  describe('pharmacy safety rules', () => {
    const freshBatch = '01920000-0000-7000-8000-00000000001a';
    const expiredBatch = '01920000-0000-7000-8000-00000000001b';

    it('VR-53 · refuses stock that is already expired at receipt', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO pharmacy.medicine_batch
             (id, medicine_id, location_id, batch_ref, expiry_date, quantity_received, quantity_remaining, received_by)
           VALUES (gen_random_uuid(),$1,$2,'B-EXPIRED', current_date - 1, 100, 100, $3)`,
          [ids.medicine, ids.location, ids.admin],
        ),
      );
      expect(state).toBe('23514'); // check_violation
    });

    it('D1 · maintains quantity_remaining from the movement log', async () => {
      await db.client.query(
        `INSERT INTO pharmacy.medicine_batch
           (id, medicine_id, location_id, batch_ref, expiry_date, quantity_received, quantity_remaining, received_by)
         VALUES ($1,$2,$3,'B-2026-114', current_date + 120, 200, 0, $4)`,
        [freshBatch, ids.medicine, ids.location, ids.admin],
      );

      await db.client.query(
        `INSERT INTO pharmacy.stock_movement (id, medicine_batch_id, kind, quantity_delta, recorded_by)
         VALUES (gen_random_uuid(),$1,'receipt',200,$2)`,
        [freshBatch, ids.admin],
      );
      await db.client.query(
        `INSERT INTO pharmacy.stock_movement (id, medicine_batch_id, kind, quantity_delta, recorded_by)
         VALUES (gen_random_uuid(),$1,'dispense',-10,$2)`,
        [freshBatch, ids.admin],
      );

      const { rows } = await db.client.query<{ quantity_remaining: number }>(
        `SELECT quantity_remaining FROM pharmacy.medicine_batch WHERE id=$1`,
        [freshBatch],
      );
      expect(Number(rows[0]?.quantity_remaining)).toBe(190);
    });

    it('VR-55 · refuses a dispense that would take a batch negative', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO pharmacy.stock_movement (id, medicine_batch_id, kind, quantity_delta, recorded_by)
           VALUES (gen_random_uuid(),$1,'dispense',-100000,$2)`,
          [freshBatch, ids.admin],
        ),
      );
      expect(state).toBe('23514');
    });

    // BR-40 / FR-MED-18: refused unconditionally. There is no override, no
    // flag and no role that permits it — this is a patient-safety rule.
    it('BR-40 · refuses dispensing from an expired batch, with no override', async () => {
      // Receive while valid, then age the batch past expiry.
      await db.client.query(
        `INSERT INTO pharmacy.medicine_batch
           (id, medicine_id, location_id, batch_ref, expiry_date, quantity_received, quantity_remaining, received_by)
         VALUES ($1,$2,$3,'B-AGEING', current_date + 1, 50, 50, $4)`,
        [expiredBatch, ids.medicine, ids.location, ids.admin],
      );
      await db.client.query(
        `UPDATE pharmacy.medicine_batch SET expiry_date = current_date - 1, version = version WHERE id=$1`,
        [expiredBatch],
      );

      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO pharmacy.stock_movement (id, medicine_batch_id, kind, quantity_delta, recorded_by)
           VALUES (gen_random_uuid(),$1,'dispense',-1,$2)`,
          [expiredBatch, ids.admin],
        ),
      );
      expect(state).toBe('23514');
    });

    it('permits an expiry-removal adjustment on an expired batch (EC-28)', async () => {
      const { rows } = await db.client.query<{ id: string }>(
        `INSERT INTO pharmacy.stock_adjustment_reason (id, code, label)
         VALUES (gen_random_uuid(),'EXPIRY_REMOVAL','Expiry removal') RETURNING id`,
      );
      await expect(
        db.client.query(
          `INSERT INTO pharmacy.stock_movement
             (id, medicine_batch_id, kind, quantity_delta, adjustment_reason_id, detail, recorded_by)
           VALUES (gen_random_uuid(),$1,'adjustment',-50,$2,'Expired stock removed from the shelf',$3)`,
          [expiredBatch, rows[0]?.id, ids.admin],
        ),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------
  // Constraints that encode a stated requirement directly.
  // -------------------------------------------------------------------
  describe('requirement-bearing CHECK constraints', () => {
    it('VR-30 · an emergency needs a reason of at least 10 characters', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO queueing.appointment
             (id, appointment_ref, clinic_session_id, unregistered_name, serial_number,
              origin, is_emergency, emergency_reason, created_by)
           VALUES (gen_random_uuid(),'MED-2026-0900',$1,'Walk In',900,'walk_in',true,'short',$2)`,
          [ids.session, ids.admin],
        ),
      );
      expect(state).toBe('23514');
    });

    it('VR-29 · a queue entry needs either a student or a name', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO queueing.appointment
             (id, appointment_ref, clinic_session_id, serial_number, origin, created_by)
           VALUES (gen_random_uuid(),'MED-2026-0901',$1,901,'walk_in',$2)`,
          [ids.session, ids.admin],
        ),
      );
      expect(state).toBe('23514');
    });

    it('FR-AUD-05 · break-glass needs a justification of at least 20 characters', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO audit.break_glass_grant (id, administrator_id, justification, expires_at)
           VALUES (gen_random_uuid(),$1,'too short', now() + interval '60 minutes')`,
          [ids.admin],
        ),
      );
      expect(state).toBe('23514');
    });

    it('FR-AUD-07 · break-glass may not exceed 60 minutes', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO audit.break_glass_grant (id, administrator_id, justification, expires_at)
           VALUES (gen_random_uuid(),$1,'A justification long enough to satisfy the twenty character rule', now() + interval '61 minutes')`,
          [ids.admin],
        ),
      );
      expect(state).toBe('23514');
    });

    it('VR-13 · a 100% walk-in allocation is refused', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO scheduling.clinic_session
             (id, doctor_id, location_id, session_date, starts_at, ends_at,
              slot_length_minutes, walk_in_allocation_pct, total_slot_count,
              bookable_slot_count, created_by)
           VALUES (gen_random_uuid(),$1,$2,'2026-09-01',
                   '2026-09-01 09:00+06','2026-09-01 11:00+06',10,100,12,0,$3)`,
          [ids.doctor, ids.location, ids.admin],
        ),
      );
      expect(state).toBe('23514');
    });

    it('VR-43 · a reconciliation discrepancy needs a reason, and discrepancy is generated', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO billing.daily_reconciliation
             (id, location_id, business_date, system_total, counted_cash, reconciled_by)
           VALUES (gen_random_uuid(),$1,'2026-08-04',1850.00,1830.00,$2)`,
          [ids.location, ids.admin],
        ),
      );
      expect(state).toBe('23514');

      const { rows } = await db.client.query<{ discrepancy: string }>(
        `INSERT INTO billing.daily_reconciliation
           (id, location_id, business_date, system_total, counted_cash, discrepancy_reason, reconciled_by)
         VALUES (gen_random_uuid(),$1,'2026-08-05',1850.00,1830.00,'Two notes missing at close; recounted twice',$2)
         RETURNING discrepancy`,
        [ids.location, ids.admin],
      );
      // EC-22: the difference is recorded as it stands. The system total is
      // never adjusted to match the count.
      expect(Number(rows[0]?.discrepancy)).toBe(-20);
    });

    it('FR-NTF-05 · a discreet template may not accept free text', async () => {
      const state = await expectRejection(() =>
        db.client.query(
          `INSERT INTO notification.notification_template
             (id, template_key, is_discreet, allows_free_text, subject_template, body_template)
           VALUES (gen_random_uuid(),'CNS_LEAKY',true,true,'You have an update','{{freeText}}')`,
        ),
      );
      expect(state).toBe('23514');
    });
  });
});
