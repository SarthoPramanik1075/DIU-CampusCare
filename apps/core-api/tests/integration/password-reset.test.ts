import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/client.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { SystemClock } from '../../src/kernel/clock/clock.js';
import { CsrfTokenService } from '../../src/kernel/identity/csrf.js';
import { SessionStore } from '../../src/kernel/identity/session-store.js';
import { enqueueNotification } from '../../src/kernel/notifications/enqueue-notification.js';
import { PolicyStore } from '../../src/kernel/policy/policy-store.js';
import {
  ConfirmPasswordResetHandler,
  KyselyAuthenticationRepository,
  KyselyPasswordResetRepository,
  LoginWithPasswordHandler,
  PasswordHasher,
  PasswordResetTokenGenerator,
  RequestPasswordResetHandler,
  SessionIssuer,
  seedIamPolicies,
} from '../../src/modules/iam/index.js';
import { createScratchDatabase, type ScratchDatabase } from '../support/scratch-database.js';

const STUDENT_ID = '01920000-0000-7000-8000-0000000000e1';
const ORIGINAL_PASSWORD = 'Correct horse battery 1!';
const NEW_PASSWORD = 'New correct horse battery 2!';

describe('Password reset — integration', () => {
  let scratch: ScratchDatabase;
  let db: Kysely<Database>;
  let clock: SystemClock;
  let passwordHasher: PasswordHasher;
  let requestHandler: RequestPasswordResetHandler;
  let confirmHandler: ConfirmPasswordResetHandler;
  let loginHandler: LoginWithPasswordHandler;
  let sentEmails: { readonly recipientId: string; readonly payload: Record<string, unknown> }[];

  beforeAll(async () => {
    scratch = await createScratchDatabase('core');
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: scratch.connectionString }) }),
    });
    clock = new SystemClock();
    passwordHasher = new PasswordHasher();

    const policyStore = new PolicyStore(db);
    await seedIamPolicies(policyStore);

    const repository = new KyselyAuthenticationRepository(db);
    const resetRepository = new KyselyPasswordResetRepository(db);
    const sessionStore = new SessionStore(db, clock);
    const auditRecorder = new AuditRecorder(db);
    const tokenGenerator = new PasswordResetTokenGenerator();
    const csrfTokenService = new CsrfTokenService('a'.repeat(32));
    const sessionIssuer = new SessionIssuer(repository, sessionStore, csrfTokenService, policyStore);

    sentEmails = [];
    requestHandler = new RequestPasswordResetHandler(
      repository,
      resetRepository,
      tokenGenerator,
      policyStore,
      auditRecorder,
      (input) => {
        sentEmails.push({ recipientId: input.recipientId, payload: input.payload ?? {} });
        return enqueueNotification(db, input);
      },
      'http://localhost:5173',
      clock,
    );
    confirmHandler = new ConfirmPasswordResetHandler(resetRepository, tokenGenerator, passwordHasher, sessionStore, auditRecorder, clock);
    loginHandler = new LoginWithPasswordHandler(
      repository,
      passwordHasher,
      sessionIssuer,
      policyStore,
      auditRecorder,
      (input) => enqueueNotification(db, input),
      clock,
    );

    await db
      .insertInto('identity.user_account')
      .values({ id: STUDENT_ID, email: 'reset-target@diu.edu.bd', full_name: 'Reset Target', status: 'active' })
      .execute();
    await db
      .insertInto('identity.local_credential')
      .values({ user_account_id: STUDENT_ID, password_hash: await passwordHasher.hash(ORIGINAL_PASSWORD) })
      .execute();
    const studentRoleId = '00000000-0000-7000-8000-000000000001';
    await db
      .insertInto('identity.user_role')
      .values({ id: '01920000-0000-7000-8000-0000000000e2', user_account_id: STUDENT_ID, role_id: studentRoleId, granted_by: STUDENT_ID })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await scratch.drop();
  });

  it('returns ok with no email queued for an unknown address — identical response either way', async () => {
    sentEmails.length = 0;
    const result = await requestHandler.execute({ email: 'nobody@diu.edu.bd', correlationId: 'corr-unknown' });

    expect(result.ok).toBe(true);
    expect(sentEmails).toHaveLength(0);
  });

  it('the full request → confirm → login round trip: old password stops working, new one works', async () => {
    sentEmails.length = 0;
    const requestResult = await requestHandler.execute({
      email: 'reset-target@diu.edu.bd',
      correlationId: 'corr-request',
    });
    expect(requestResult.ok).toBe(true);
    expect(sentEmails).toHaveLength(1);

    const resetLink = sentEmails[0]!.payload.resetLink as string;
    const rawToken = new URL(resetLink).searchParams.get('token')!;

    const row = await db
      .selectFrom('identity.password_reset_token')
      .selectAll()
      .where('user_account_id', '=', STUDENT_ID)
      .executeTakeFirstOrThrow();
    expect(row.consumed_at).toBeNull();

    const confirmResult = await confirmHandler.execute({
      token: rawToken,
      newPassword: NEW_PASSWORD,
      correlationId: 'corr-confirm',
    });
    expect(confirmResult.ok).toBe(true);

    const consumedRow = await db
      .selectFrom('identity.password_reset_token')
      .selectAll()
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(consumedRow.consumed_at).not.toBeNull();

    const oldPasswordAttempt = await loginHandler.execute({
      email: 'reset-target@diu.edu.bd',
      password: ORIGINAL_PASSWORD,
      sourceAddress: '127.0.0.1',
      correlationId: 'corr-old-password',
    });
    expect(oldPasswordAttempt.ok).toBe(false);

    const newPasswordAttempt = await loginHandler.execute({
      email: 'reset-target@diu.edu.bd',
      password: NEW_PASSWORD,
      sourceAddress: '127.0.0.1',
      correlationId: 'corr-new-password',
    });
    expect(newPasswordAttempt.ok).toBe(true);
  });

  it('a reused token is rejected with RESET_TOKEN_INVALID', async () => {
    sentEmails.length = 0;
    await requestHandler.execute({ email: 'reset-target@diu.edu.bd', correlationId: 'corr-reuse-request' });
    const resetLink = sentEmails[0]!.payload.resetLink as string;
    const rawToken = new URL(resetLink).searchParams.get('token')!;

    const first = await confirmHandler.execute({ token: rawToken, newPassword: NEW_PASSWORD, correlationId: 'corr-reuse-1' });
    expect(first.ok).toBe(true);

    const second = await confirmHandler.execute({ token: rawToken, newPassword: 'Another correct 3!', correlationId: 'corr-reuse-2' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('RESET_TOKEN_INVALID');
  });
});
