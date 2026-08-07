import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/bootstrap/app.js';
import type { Container } from '../../src/bootstrap/container.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { PolicyDecisionPoint } from '../../src/kernel/authz/policy-decision-point.js';
import { CsrfTokenService } from '../../src/kernel/identity/csrf.js';
import { resolveAnonymousSubject } from '../../src/kernel/identity/subject-resolver.js';
import {
  GetSessionQuery,
  LoginWithPasswordHandler,
  LogoutHandler,
  PasswordHasher,
  type AccountSummary,
  type AccountWithCredential,
  type AuthenticationRepository,
} from '../../src/modules/iam/index.js';
import { FixedClock } from '../support/fixed-clock.js';

interface ErrorEnvelopeBody {
  readonly error: { readonly code: string; readonly message: string; readonly correlationId: string };
}

interface LoginSuccessBody {
  readonly userId: string;
  readonly fullName: string;
  readonly roles: readonly string[];
  readonly csrfToken: string;
  readonly sessionExpiresAt: string;
  readonly idleTimeoutMinutes: number;
}

const NOW = new Date('2026-08-03T14:00:00+06:00');
const PASSWORD = 'Correct horse battery 1!';

class InMemoryAuthenticationRepository implements AuthenticationRepository {
  private failedAttempts = 0;
  private lockedUntil: Date | null = null;

  constructor(private readonly account: AccountWithCredential) {}

  findAccountWithCredentialByEmail(email: string): Promise<AccountWithCredential | null> {
    if (email.toLowerCase() !== this.account.email.toLowerCase()) return Promise.resolve(null);
    return Promise.resolve({ ...this.account, failedAttempts: this.failedAttempts, lockedUntil: this.lockedUntil });
  }

  findAccountById(userAccountId: string): Promise<AccountSummary | null> {
    if (userAccountId !== this.account.id) return Promise.resolve(null);
    const { id, email, fullName, status, version } = this.account;
    return Promise.resolve({ id, email, fullName, status, version });
  }

  loadActiveRoleCodes() {
    return Promise.resolve(['STU'] as const);
  }

  recordFailedAttempt(_userAccountId: string, lockedUntil: Date | null): Promise<void> {
    this.failedAttempts += 1;
    this.lockedUntil = lockedUntil;
    return Promise.resolve();
  }

  resetFailedAttempts(): Promise<void> {
    this.failedAttempts = 0;
    this.lockedUntil = null;
    return Promise.resolve();
  }

  recordLoginAttempt(): Promise<void> {
    return Promise.resolve();
  }
}

async function buildTestApp(): Promise<{ app: FastifyInstance; repository: InMemoryAuthenticationRepository }> {
  const passwordHasher = new PasswordHasher();
  const account: AccountWithCredential = {
    id: '0191f5aa-0000-7000-8000-000000000201',
    email: 'nusrat@diu.edu.bd',
    fullName: 'Nusrat Jahan',
    status: 'active',
    version: 1,
    passwordHash: await passwordHasher.hash(PASSWORD),
    failedAttempts: 0,
    lockedUntil: null,
  };
  const repository = new InMemoryAuthenticationRepository(account);
  const clock = new FixedClock(NOW);
  const csrfTokenService = new CsrfTokenService('a'.repeat(32));

  // No database in this tier — session state lives in this Map instead of
  // `identity.user_session`, since the contract under test is HTTP shape,
  // not persistence (that's `login-with-password.test.ts`, against real
  // Postgres).
  const sessions = new Map<string, { userAccountId: string; expiresAt: Date }>();
  const sessionStore = {
    create: ({ userAccountId, idleTimeoutMs }: { userAccountId: string; idleTimeoutMs: number }) => {
      const id = `session-${String(sessions.size + 1)}`;
      const record = { id, userAccountId, issuedAt: clock.now(), expiresAt: new Date(clock.now().getTime() + idleTimeoutMs), lastSeenAt: clock.now(), clientFingerprint: null };
      sessions.set(id, record);
      return Promise.resolve(record);
    },
    revokeAllForUser: () => Promise.resolve(),
    revoke: (id: string) => {
      sessions.delete(id);
      return Promise.resolve();
    },
    peek: (id: string) => Promise.resolve(sessions.get(id) ?? null),
    validateAndTouch: (id: string) => Promise.resolve(sessions.get(id) ?? null),
  } as unknown as Container['sessionStore'];

  const policyStore = {
    getRequiredInteger: (key: string) => {
      const values: Record<string, number> = {
        'auth.lockout.maxAttempts': 5,
        'auth.lockout.durationMinutes': 15,
        'auth.session.idleTimeoutMinutes.student': 30,
        'auth.session.idleTimeoutMinutes.staff': 15,
      };
      return Promise.resolve(values[key]!);
    },
  } as unknown as Container['policyStore'];

  // No database in this tier (HTTP shape only, not persistence — that's
  // `login-with-password.test.ts` against real Postgres), so `recordChange`
  // is a plain no-op rather than the real DB-backed implementation.
  const auditRecorder = { recordChange: () => Promise.resolve() } as unknown as AuditRecorder;

  const loginWithPassword = new LoginWithPasswordHandler(
    repository,
    passwordHasher,
    sessionStore,
    csrfTokenService,
    policyStore,
    auditRecorder,
    () => Promise.resolve(),
    clock,
  );
  const getSession = new GetSessionQuery(repository, sessionStore, csrfTokenService, policyStore);
  const logout = new LogoutHandler(sessionStore, auditRecorder);

  const container: Container = {
    config: {
      nodeEnv: 'test',
      logLevel: 'silent',
      port: 0,
      databaseUrl: 'unused-in-this-test',
      webAppOrigin: 'http://localhost:5173',
      featureCounselingEnabled: false,
      featureEmailEnabled: false,
      sessionSecret: 'a'.repeat(32),
    },
    logger: { level: 'silent', error: () => undefined, info: () => undefined } as unknown as Container['logger'],
    db: undefined as unknown as Container['db'],
    clock,
    eventBus: undefined as unknown as Container['eventBus'],
    policyStore,
    auditRecorder,
    pdp: new PolicyDecisionPoint(),
    passwordHasher,
    sessionStore,
    csrfTokenService,
    resolveSubject: () => Promise.resolve(resolveAnonymousSubject()),
    listActiveAnnouncements: undefined as unknown as Container['listActiveAnnouncements'],
    loginWithPassword,
    logout,
    getSession,
  };

  return { app: await buildApp(container), repository };
}

describe('Auth routes — contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('POST /api/v1/auth/login — 200, sets the session cookie, matches the documented shape', async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nusrat@diu.edu.bd', password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const cookies = response.cookies.map((c) => c.name);
    expect(cookies).toContain('ccc_session');

    const body = response.json<LoginSuccessBody>();
    expect(Object.keys(body).sort()).toEqual(
      ['csrfToken', 'fullName', 'idleTimeoutMinutes', 'roles', 'sessionExpiresAt', 'userId'].sort(),
    );
    expect(body.roles).toEqual(['STU']);
    expect(body.idleTimeoutMinutes).toBe(30);
    expect(body.sessionExpiresAt).toMatch(/\+06:00$/);
  });

  it('POST /api/v1/auth/login — 401 with the generic envelope for a wrong password', async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nusrat@diu.edu.bd', password: 'wrong' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json<ErrorEnvelopeBody>();
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
    expect(typeof body.error.correlationId).toBe('string');
  });

  it('POST /api/v1/auth/login — 422 when the email or password field is missing', async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'nusrat@diu.edu.bd' } });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('VALIDATION_FAILED');
  });

  it('GET /api/v1/auth/session — 401 with no session cookie', async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/auth/session — 200 after a real login, reflecting the session', async () => {
    ({ app } = await buildTestApp());

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nusrat@diu.edu.bd', password: PASSWORD },
    });
    const cookieHeader = loginResponse.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ email: string }>().email).toBe('nusrat@diu.edu.bd');
  });

  it('POST /api/v1/auth/logout — 204 and clears the cookie', async () => {
    ({ app } = await buildTestApp());

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nusrat@diu.edu.bd', password: PASSWORD },
    });
    const cookieHeader = loginResponse.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: cookieHeader } });
    expect(response.statusCode).toBe(204);

    const sessionAfterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: cookieHeader },
    });
    expect(sessionAfterLogout.statusCode).toBe(401);
  });

  it('logging out twice is not an error — API §1.4', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(response.statusCode).toBe(204);
  });
});
