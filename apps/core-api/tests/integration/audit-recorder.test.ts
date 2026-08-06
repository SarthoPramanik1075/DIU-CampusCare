import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { createScratchDatabase, expectRejection, type ScratchDatabase } from '../support/scratch-database.js';

describe('AuditRecorder', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let recorder: AuditRecorder;
  let actorId: string;
  let subjectId: string;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    recorder = new AuditRecorder(db);

    // actor_id / accessor_id / subject_id are foreign keys to
    // identity.user_account — real rows, not fabricated UUIDs, are needed to
    // satisfy them.
    await db
      .insertInto('config.location')
      .values({ id: '01920000-0000-7000-8000-0000000000d0', code: 'MAIN', name: 'Main' })
      .execute();
    actorId = '01920000-0000-7000-8000-0000000000d1';
    subjectId = '01920000-0000-7000-8000-0000000000d2';
    await db
      .insertInto('identity.user_account')
      .values([
        {
          id: actorId,
          email: 'staff@diu.edu.bd',
          full_name: 'Farhana Akter',
          location_id: '01920000-0000-7000-8000-0000000000d0',
        },
        {
          id: subjectId,
          email: 'student@diu.edu.bd',
          full_name: 'Nusrat Jahan',
          location_id: '01920000-0000-7000-8000-0000000000d0',
        },
      ])
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  describe('recordChange — FR-AUD-01/02, BR-60', () => {
    it('writes a row with before/after state and generates its own id', async () => {
      await recorder.recordChange({
        entityType: 'appointment',
        entityId: '01920000-0000-7000-8000-0000000000a1',
        action: 'status_advanced',
        beforeState: { status: 'waiting' },
        afterState: { status: 'in_consultation' },
        actorId,
        actorRole: 'MCS',
        correlationId: 'corr-1',
      });

      const rows = await db.selectFrom('audit.audit_log').selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entity_type: 'appointment',
        action: 'status_advanced',
        before_state: { status: 'waiting' },
        after_state: { status: 'in_consultation' },
        actor_role: 'MCS',
        correlation_id: 'corr-1',
      });
      expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('accepts a system action with no actor', async () => {
      await recorder.recordChange({ entityType: 'medicine_batch', action: 'expiry_swept' });
      const row = await db
        .selectFrom('audit.audit_log')
        .selectAll()
        .where('action', '=', 'expiry_swept')
        .executeTakeFirstOrThrow();
      expect(row.actor_id).toBeNull();
    });
  });

  describe('recordDenial — PRM-12', () => {
    it('writes a denial with actor, resource, operation and reason', async () => {
      await recorder.recordDenial({
        actorId,
        attemptedRole: 'STO',
        resource: 'payment-record',
        operation: 'read',
        reason: 'NO_MATCHING_RULE',
        correlationId: 'corr-2',
      });

      const row = await db
        .selectFrom('audit.authz_denial')
        .selectAll()
        .where('correlation_id', '=', 'corr-2')
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        attempted_role: 'STO',
        resource: 'payment-record',
        operation: 'read',
        reason: 'NO_MATCHING_RULE',
      });
    });
  });

  describe('recordDataAccess — FR-AUD-03', () => {
    it('writes an access record naming both the accessor and the subject', async () => {
      await recorder.recordDataAccess({
        accessorId: actorId,
        subjectId,
        dataCategory: 'appointment',
      });
      const row = await db.selectFrom('audit.data_access_log').selectAll().executeTakeFirstOrThrow();
      expect(row.data_category).toBe('appointment');
    });
  });

  // BR-61 / FR-AUD-02 — re-confirms, from the class's own connection, that the
  // append-only guarantee holds even though AuditRecorder never attempts a
  // mutation itself. Defence in depth is only real if both layers are tested.
  describe('append-only enforcement holds under this connection too', () => {
    it('refuses to update a row this recorder just wrote', async () => {
      const [row] = await db.selectFrom('audit.audit_log').select('id').limit(1).execute();
      const state = await expectRejection(() =>
        db.updateTable('audit.audit_log').set({ action: 'tampered' }).where('id', '=', row?.id ?? '').execute(),
      );
      expect(state).toBe('23001');
    });
  });
});
