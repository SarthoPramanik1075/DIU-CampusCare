import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { CsrfTokenService } from '../../src/kernel/identity/csrf.js';
import { SessionStore } from '../../src/kernel/identity/session-store.js';
import { enqueueNotification } from '../../src/kernel/notifications/enqueue-notification.js';
import { PolicyStore } from '../../src/kernel/policy/policy-store.js';
import {
  KyselyAuthenticationRepository,
  LoginWithPasswordHandler,
  PasswordHasher,
  seedIamPolicies,
} from '../../src/modules/iam/index.js';
import { FixedClock } from '../support/fixed-clock.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

const NOW = new Date('2026-08-03T14:00:00+06:00');
const STUDENT_ID = '01920000-0000-7000-8000-0000000000d1';
const PASSWORD = 'Correct horse battery 1!';

describe('LoginWithPasswordHandler — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let clock: FixedClock;
  let handler: LoginWithPasswordHandler;
  let passwordHasher: PasswordHasher;

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    clock = new FixedClock(NOW);
    passwordHasher = new PasswordHasher();

    const policyStore = new PolicyStore(db);
    await seedIamPolicies(policyStore);

    const repository = new KyselyAuthenticationRepository(db);
    const sessionStore = new SessionStore(db, clock);
    const csrfTokenService = new CsrfTokenService('a'.repeat(32));
    const auditRecorder = new AuditRecorder(db);

    handler = new LoginWithPasswordHandler(
      repository,
      passwordHasher,
      sessionStore,
      csrfTokenService,
      policyStore,
      auditRecorder,
      (input) => enqueueNotification(db, input),
      clock,
    );

    await db
      .insertInto('identity.user_account')
      .values({ id: STUDENT_ID, email: 'nusrat@diu.edu.bd', full_name: 'Nusrat Jahan', status: 'active' })
      .execute();
    await db
      .insertInto('identity.local_credential')
      .values({ user_account_id: STUDENT_ID, password_hash: await passwordHasher.hash(PASSWORD) })
      .execute();
    const studentRoleId = '00000000-0000-7000-8000-000000000001';
    await db
      .insertInto('identity.user_role')
      .values({ id: '01920000-0000-7000-8000-0000000000d2', user_account_id: STUDENT_ID, role_id: studentRoleId, granted_by: STUDENT_ID })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  beforeEach(async () => {
    await db
      .updateTable('identity.local_credential')
      .set({ failed_attempts: 0, locked_until: null })
      .where('user_account_id', '=', STUDENT_ID)
      .execute();
  });

  it('succeeds with the correct password, returns roles and a session, and writes a successful login_attempt', async () => {
    const result = await handler.execute({
      email: 'nusrat@diu.edu.bd',
      password: PASSWORD,
      sourceAddress: '127.0.0.1',
      correlationId: 'corr-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.roles).toEqual(['STU']);
      expect(result.value.idleTimeoutMinutes).toBe(30);
    }

    const attempts = await db
      .selectFrom('identity.login_attempt')
      .selectAll()
      .where('user_account_id', '=', STUDENT_ID)
      .where('succeeded', '=', true)
      .execute();
    expect(attempts.length).toBeGreaterThan(0);
  });

  it('rejects a wrong password with INVALID_CREDENTIALS and increments failed_attempts', async () => {
    const result = await handler.execute({
      email: 'nusrat@diu.edu.bd',
      password: 'the wrong password',
      sourceAddress: '127.0.0.1',
      correlationId: 'corr-2',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_CREDENTIALS');

    const credential = await db
      .selectFrom('identity.local_credential')
      .selectAll()
      .where('user_account_id', '=', STUDENT_ID)
      .executeTakeFirstOrThrow();
    expect(credential.failed_attempts).toBe(1);
  });

  it('locks the account after 5 consecutive failures and queues an email notice', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await handler.execute({
        email: 'nusrat@diu.edu.bd',
        password: 'still wrong',
        sourceAddress: '127.0.0.1',
        correlationId: `corr-lock-${String(attempt)}`,
      });
    }

    const credential = await db
      .selectFrom('identity.local_credential')
      .selectAll()
      .where('user_account_id', '=', STUDENT_ID)
      .executeTakeFirstOrThrow();
    expect(credential.locked_until).not.toBeNull();

    // The now-locked account refuses even the correct password.
    const lockedAttempt = await handler.execute({
      email: 'nusrat@diu.edu.bd',
      password: PASSWORD,
      sourceAddress: '127.0.0.1',
      correlationId: 'corr-locked-check',
    });
    expect(lockedAttempt.ok).toBe(false);
    if (!lockedAttempt.ok) expect(lockedAttempt.error.code).toBe('ACCOUNT_LOCKED');

    const notification = await db
      .selectFrom('notification.notification')
      .selectAll()
      .where('recipient_id', '=', STUDENT_ID)
      .executeTakeFirst();
    expect(notification).toBeDefined();
  });

  it('never confirms whether an account exists — identical error for unknown email and wrong password', async () => {
    const unknown = await handler.execute({
      email: 'nobody@diu.edu.bd',
      password: 'whatever',
      sourceAddress: '127.0.0.1',
      correlationId: 'corr-unknown',
    });
    const wrongPassword = await handler.execute({
      email: 'nusrat@diu.edu.bd',
      password: 'wrong again',
      sourceAddress: '127.0.0.1',
      correlationId: 'corr-wrong',
    });

    expect(!unknown.ok && !wrongPassword.ok).toBe(true);
    if (!unknown.ok && !wrongPassword.ok) {
      expect(unknown.error.code).toBe(wrongPassword.error.code);
      expect(unknown.error.message).toBe(wrongPassword.error.message);
    }
  });
});
