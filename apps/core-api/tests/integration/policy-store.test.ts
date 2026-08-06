import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { PolicyStore } from '../../src/kernel/policy/policy-store.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

describe('PolicyStore', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let store: PolicyStore;
  const ADMIN_ID = '01920000-0000-7000-8000-0000000000b1';

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    store = new PolicyStore(db);
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  describe('defineIfAbsent', () => {
    it('creates a new entry', async () => {
      await store.defineIfAbsent({
        key: 'booking.max_active_per_student',
        valueType: 'integer',
        valueText: '2',
        minValue: '1',
        maxValue: '10',
        description: 'Maximum simultaneous active bookings per student (BR-11, OI-08)',
      });
      const value = await store.get('booking.max_active_per_student');
      expect(value).toMatchObject({ valueText: '2', minValue: '1', maxValue: '10', version: 1 });
    });

    it('is idempotent — a second call never overwrites an administrator-changed value', async () => {
      const first = await store.get('booking.max_active_per_student');
      await store.set({
        key: 'booking.max_active_per_student',
        valueText: '3',
        updatedBy: ADMIN_ID,
        expectedVersion: first?.version ?? 0,
      });

      await store.defineIfAbsent({
        key: 'booking.max_active_per_student',
        valueType: 'integer',
        valueText: '2', // the "default" — must NOT clobber the administrator's "3"
        description: 'Maximum simultaneous active bookings per student (BR-11, OI-08)',
      });

      const value = await store.get('booking.max_active_per_student');
      expect(value?.valueText).toBe('3');
    });
  });

  describe('get / list', () => {
    it('returns undefined for an unknown key', async () => {
      await expect(store.get('does.not.exist')).resolves.toBeUndefined();
    });

    it('lists entries filtered by key prefix', async () => {
      await store.defineIfAbsent({
        key: 'scheduling.slot_length_minutes',
        valueType: 'integer',
        valueText: '10',
        minValue: '5',
        maxValue: '60',
        description: 'Default consultation slot length (OI-05, VR-12)',
      });

      const bookingOnly = await store.list('booking.');
      expect(bookingOnly.map((v) => v.key)).toEqual(['booking.max_active_per_student']);
    });
  });

  describe('getRequiredInteger / getRequiredBoolean', () => {
    it('parses an integer value', async () => {
      await expect(store.getRequiredInteger('scheduling.slot_length_minutes')).resolves.toBe(10);
    });

    it('throws ValidationError for a missing key — DR-4 has no sensible fallback', async () => {
      await expect(store.getRequiredInteger('nonexistent.key')).rejects.toMatchObject({
        code: 'CONFIG_KEY_UNKNOWN',
      });
    });

    it('throws ValidationError for a non-integer value', async () => {
      await store.defineIfAbsent({
        key: 'flags.counseling_enabled',
        valueType: 'boolean',
        valueText: 'true',
        description: 'Feature flag',
      });
      await expect(store.getRequiredInteger('flags.counseling_enabled')).rejects.toMatchObject({
        code: 'CONFIG_TYPE_MISMATCH',
      });
      await expect(store.getRequiredBoolean('flags.counseling_enabled')).resolves.toBe(true);
    });
  });

  // VR-94 — the whole reason this class validates at save rather than at use.
  describe('set — VR-94 range validation', () => {
    it('rejects a value below the minimum, naming the permitted range', async () => {
      const current = await store.get('booking.max_active_per_student');
      const result = await store.set({
        key: 'booking.max_active_per_student',
        valueText: '0',
        updatedBy: ADMIN_ID,
        expectedVersion: current?.version ?? 0,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONFIG_OUT_OF_RANGE');
        // Both min and max are set for this key, so the message states the
        // full range rather than the "at least" phrasing used when only one
        // bound exists.
        expect(result.error.message).toContain('between 1 and 10');
      }
    });

    it('rejects a value above the maximum', async () => {
      const current = await store.get('booking.max_active_per_student');
      const result = await store.set({
        key: 'booking.max_active_per_student',
        valueText: '11',
        updatedBy: ADMIN_ID,
        expectedVersion: current?.version ?? 0,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CONFIG_OUT_OF_RANGE');
    });

    it('rejects a non-numeric value for an integer setting', async () => {
      const current = await store.get('booking.max_active_per_student');
      const result = await store.set({
        key: 'booking.max_active_per_student',
        valueText: 'not-a-number',
        updatedBy: ADMIN_ID,
        expectedVersion: current?.version ?? 0,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CONFIG_TYPE_MISMATCH');
    });

    it('accepts a value within range and increments the version', async () => {
      const current = await store.get('booking.max_active_per_student');
      const result = await store.set({
        key: 'booking.max_active_per_student',
        valueText: '4',
        updatedBy: ADMIN_ID,
        expectedVersion: current?.version ?? 0,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.valueText).toBe('4');
        expect(result.value.version).toBe((current?.version ?? 0) + 1);
      }
    });

    it('rejects an unknown key', async () => {
      const result = await store.set({
        key: 'does.not.exist',
        valueText: '1',
        updatedBy: ADMIN_ID,
        expectedVersion: 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CONFIG_KEY_UNKNOWN');
    });

    // VR-92 / EC-19 — a stale write is rejected, never merged.
    it('rejects a write against a stale version', async () => {
      const current = await store.get('booking.max_active_per_student');
      const staleVersion = (current?.version ?? 1) - 1;
      const result = await store.set({
        key: 'booking.max_active_per_student',
        valueText: '5',
        updatedBy: ADMIN_ID,
        expectedVersion: staleVersion,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CONFLICT_STALE_VERSION');

      // And the value was not changed by the rejected write.
      const unchanged = await store.get('booking.max_active_per_student');
      expect(unchanged?.valueText).toBe('4');
    });

    it('permits a text-type value with no range check at all', async () => {
      await store.defineIfAbsent({
        key: 'notification.sender_name',
        valueType: 'text',
        valueText: 'DIU Medical Centre',
        description: 'Display name on outbound email',
      });
      const current = await store.get('notification.sender_name');
      const result = await store.set({
        key: 'notification.sender_name',
        valueText: 'DIU Medical Centre (Main Campus)',
        updatedBy: ADMIN_ID,
        expectedVersion: current?.version ?? 0,
      });
      expect(result.ok).toBe(true);
    });
  });
});
