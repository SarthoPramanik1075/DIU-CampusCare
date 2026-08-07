import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { SessionStore } from '../../src/kernel/identity/session-store.js';
import { FixedClock } from '../support/fixed-clock.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

const STUDENT_TIMEOUT_MS = 30 * 60 * 1000; // FR-AUTH-06 — fetched from PolicyStore in real use, fixed here for the test
const NOW = new Date('2026-08-04T08:00:00+06:00');

describe('SessionStore', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let clock: FixedClock;
  let store: SessionStore;
  const userId = '01920000-0000-7000-8000-0000000000f1';

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    clock = new FixedClock(NOW);
    store = new SessionStore(db, clock);

    await db
      .insertInto('config.location')
      .values({ id: '01920000-0000-7000-8000-0000000000f0', code: 'MAIN', name: 'Main' })
      .execute();
    await db
      .insertInto('identity.user_account')
      .values({
        id: userId,
        email: 'student@diu.edu.bd',
        full_name: 'Nusrat Jahan',
        location_id: '01920000-0000-7000-8000-0000000000f0',
      })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  describe('create', () => {
    it('issues a session expiring idleTimeoutMs from now', async () => {
      const session = await store.create({ userAccountId: userId, idleTimeoutMs: STUDENT_TIMEOUT_MS });
      expect(session.userAccountId).toBe(userId);
      expect(session.expiresAt.getTime()).toBe(NOW.getTime() + STUDENT_TIMEOUT_MS);
      expect(session.issuedAt).toEqual(NOW);
    });

    it('records the client fingerprint when supplied', async () => {
      const session = await store.create({
        userAccountId: userId,
        idleTimeoutMs: STUDENT_TIMEOUT_MS,
        clientFingerprint: 'fp-abc',
      });
      expect(session.clientFingerprint).toBe('fp-abc');
    });
  });

  describe('peek', () => {
    it('returns the session without sliding its expiry', async () => {
      const created = await store.create({ userAccountId: userId, idleTimeoutMs: STUDENT_TIMEOUT_MS });

      clock.advanceMs(5 * 60 * 1000);
      const peeked = await store.peek(created.id);

      expect(peeked).not.toBeNull();
      expect(peeked?.expiresAt.getTime()).toBe(created.expiresAt.getTime()); // unchanged
    });

    it('returns null for an unknown, expired or revoked session — same as validateAndTouch', async () => {
      await expect(store.peek('01920000-0000-7000-8000-ffffffffffff')).resolves.toBeNull();

      const expiring = await store.create({ userAccountId: userId, idleTimeoutMs: 1000 });
      clock.advanceMs(1001);
      await expect(store.peek(expiring.id)).resolves.toBeNull();

      clock.advanceMs(-1001); // restore, so the next case starts from a clean baseline
      const revoked = await store.create({ userAccountId: userId, idleTimeoutMs: STUDENT_TIMEOUT_MS });
      await store.revoke(revoked.id);
      await expect(store.peek(revoked.id)).resolves.toBeNull();
    });
  });

  describe('validateAndTouch', () => {
    it('returns the session and slides the expiry forward on activity', async () => {
      const created = await store.create({ userAccountId: userId, idleTimeoutMs: STUDENT_TIMEOUT_MS });

      clock.advanceMs(5 * 60 * 1000); // 5 minutes pass
      const touched = await store.validateAndTouch(created.id, STUDENT_TIMEOUT_MS);

      expect(touched).not.toBeNull();
      expect(touched?.expiresAt.getTime()).toBe(clock.now().getTime() + STUDENT_TIMEOUT_MS);
      expect(touched?.expiresAt.getTime()).toBeGreaterThan(created.expiresAt.getTime());
    });

    // API §0.4 rule 2, applied to session validation: the caller cannot tell
    // "never existed" from "expired" from "revoked" apart from this result.
    it('returns null for an unknown session id', async () => {
      await expect(store.validateAndTouch('01920000-0000-7000-8000-ffffffffffff', STUDENT_TIMEOUT_MS)).resolves.toBeNull();
    });

    it('returns null for an expired session and does not resurrect it', async () => {
      const created = await store.create({ userAccountId: userId, idleTimeoutMs: 1000 });
      clock.advanceMs(1001);
      await expect(store.validateAndTouch(created.id, STUDENT_TIMEOUT_MS)).resolves.toBeNull();
    });

    it('returns null for a revoked session even before its natural expiry', async () => {
      const created = await store.create({ userAccountId: userId, idleTimeoutMs: STUDENT_TIMEOUT_MS });
      await store.revoke(created.id);
      await expect(store.validateAndTouch(created.id, STUDENT_TIMEOUT_MS)).resolves.toBeNull();
    });
  });

  describe('revoke — FR-AUTH-07', () => {
    it('is idempotent — revoking an already-revoked session is not an error', async () => {
      const created = await store.create({ userAccountId: userId, idleTimeoutMs: STUDENT_TIMEOUT_MS });
      await store.revoke(created.id);
      await expect(store.revoke(created.id)).resolves.toBeUndefined();
    });
  });

  describe('revokeAllForUser — NFR-SEC-08', () => {
    it('revokes every live session for the user, leaving other users untouched', async () => {
      const otherUserId = '01920000-0000-7000-8000-0000000000f2';
      await db
        .insertInto('identity.user_account')
        .values({
          id: otherUserId,
          email: 'other@diu.edu.bd',
          full_name: 'Rakib Hasan',
          location_id: '01920000-0000-7000-8000-0000000000f0',
        })
        .execute();

      const sessionA = await store.create({ userAccountId: userId, idleTimeoutMs: STUDENT_TIMEOUT_MS });
      const sessionB = await store.create({ userAccountId: userId, idleTimeoutMs: STUDENT_TIMEOUT_MS });
      const otherSession = await store.create({ userAccountId: otherUserId, idleTimeoutMs: STUDENT_TIMEOUT_MS });

      await store.revokeAllForUser(userId);

      await expect(store.validateAndTouch(sessionA.id, STUDENT_TIMEOUT_MS)).resolves.toBeNull();
      await expect(store.validateAndTouch(sessionB.id, STUDENT_TIMEOUT_MS)).resolves.toBeNull();
      await expect(store.validateAndTouch(otherSession.id, STUDENT_TIMEOUT_MS)).resolves.not.toBeNull();
    });
  });
});
