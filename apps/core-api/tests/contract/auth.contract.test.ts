import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/bootstrap/app.js';
import type { Container } from '../../src/bootstrap/container.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { PolicyDecisionPoint } from '../../src/kernel/authz/policy-decision-point.js';
import { CsrfTokenService } from '../../src/kernel/identity/csrf.js';
import { resolveAnonymousSubject } from '../../src/kernel/identity/subject-resolver.js';
import {
  ConfirmPasswordResetHandler,
  GetSessionQuery,
  LoginWithPasswordHandler,
  LogoutHandler,
  PasswordHasher,
  PasswordResetTokenGenerator,
  RequestPasswordResetHandler,
  SessionIssuer,
  SsoCallbackHandler,
  SsoLoginHandler,
  type AccountSummary,
  type AccountWithCredential,
  type AuthenticationRepository,
  type CreateResetTokenInput,
  type PasswordResetRepository,
  type SsoClient,
  type ValidResetToken,
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

  constructor(private account: AccountWithCredential) {}

  // Password reset writes through `PasswordResetRepository`, a distinct
  // port from this one — in real Postgres they share the same
  // `identity.local_credential` row, so this fake needs the same wiring for
  // "reset then log in with the new password" to be provable at this tier.
  setPasswordHash(passwordHash: string): void {
    this.account = { ...this.account, passwordHash };
  }

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

  findOrProvisionBySsoSubject(): Promise<AccountSummary> {
    throw new Error('not exercised by this contract suite — see login-with-password.test.ts for SSO paths');
  }
}

class InMemoryPasswordResetRepository implements PasswordResetRepository {
  private tokens = new Map<string, ValidResetToken & { expiresAt: Date; consumedAt: Date | null }>();
  private nextId = 1;
  passwordHashesByAccount = new Map<string, string>();

  constructor(private readonly authRepository: InMemoryAuthenticationRepository) {}

  createToken(input: CreateResetTokenInput): Promise<void> {
    const id = `token-${String(this.nextId++)}`;
    this.tokens.set(input.tokenHash, { id, userAccountId: input.userAccountId, expiresAt: input.expiresAt, consumedAt: null });
    return Promise.resolve();
  }

  findValidToken(tokenHash: string, now: Date): Promise<ValidResetToken | null> {
    const token = this.tokens.get(tokenHash);
    if (token?.consumedAt !== null || token.expiresAt.getTime() <= now.getTime()) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ id: token.id, userAccountId: token.userAccountId });
  }

  consumeToken(tokenId: string, now: Date): Promise<void> {
    for (const token of this.tokens.values()) {
      if (token.id === tokenId) token.consumedAt = now;
    }
    return Promise.resolve();
  }

  updatePasswordHash(userAccountId: string, newPasswordHash: string): Promise<void> {
    this.passwordHashesByAccount.set(userAccountId, newPasswordHash);
    this.authRepository.setPasswordHash(newPasswordHash);
    return Promise.resolve();
  }
}

interface SentEmail {
  readonly recipientId: string;
  readonly payload: Record<string, unknown>;
}

async function buildTestApp(): Promise<{
  app: FastifyInstance;
  repository: InMemoryAuthenticationRepository;
  sentEmails: SentEmail[];
}> {
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
        'auth.passwordReset.expiryMinutes': 30,
      };
      return Promise.resolve(values[key]!);
    },
  } as unknown as Container['policyStore'];

  // No database in this tier (HTTP shape only, not persistence — that's
  // `login-with-password.test.ts` against real Postgres), so `recordChange`
  // is a plain no-op rather than the real DB-backed implementation.
  const auditRecorder = { recordChange: () => Promise.resolve() } as unknown as AuditRecorder;

  const sessionIssuer = new SessionIssuer(repository, sessionStore, csrfTokenService, policyStore);
  const loginWithPassword = new LoginWithPasswordHandler(
    repository,
    passwordHasher,
    sessionIssuer,
    policyStore,
    auditRecorder,
    () => Promise.resolve(),
    clock,
  );
  const getSession = new GetSessionQuery(repository, sessionStore, csrfTokenService, policyStore);
  const logout = new LogoutHandler(sessionStore, auditRecorder);

  // Not configured in this tier — the SSO round trip needs a real IdP
  // (`login-with-password.test.ts` documents why that can't be tested
  // here); constructing real handlers around an unconfigured client still
  // lets this suite assert the 503 SSO_UNAVAILABLE degradation.
  const unconfiguredSsoClient: SsoClient = {
    isConfigured: false,
    createAuthorizationRequest: () => {
      throw new Error('unreachable — isConfigured is false');
    },
    completeLogin: () => {
      throw new Error('unreachable — isConfigured is false');
    },
  };
  const ssoLogin = new SsoLoginHandler(unconfiguredSsoClient);
  const ssoCallback = new SsoCallbackHandler(unconfiguredSsoClient, repository, sessionIssuer, auditRecorder);

  const resetRepository = new InMemoryPasswordResetRepository(repository);
  const tokenGenerator = new PasswordResetTokenGenerator();
  const sentEmails: SentEmail[] = [];
  const requestPasswordReset = new RequestPasswordResetHandler(
    repository,
    resetRepository,
    tokenGenerator,
    policyStore,
    auditRecorder,
    (input) => {
      sentEmails.push({ recipientId: input.recipientId, payload: input.payload ?? {} });
      return Promise.resolve();
    },
    'http://localhost:5173',
    clock,
  );
  const confirmPasswordReset = new ConfirmPasswordResetHandler(
    resetRepository,
    tokenGenerator,
    passwordHasher,
    sessionStore,
    auditRecorder,
    clock,
  );

  const container: Container = {
    config: {
      nodeEnv: 'test',
      logLevel: 'silent',
      port: 0,
      databaseUrl: 'unused-in-this-test',
      webAppOrigin: 'http://localhost:5173',
      webAppOrigins: ['http://localhost:5173'],
      featureCounselingEnabled: false,
      featureEmailEnabled: false,
      sessionSecret: 'a'.repeat(32),
      sso: undefined,
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
    ssoLogin,
    ssoCallback,
    requestPasswordReset,
    confirmPasswordReset,
    getOwnProfile: undefined as unknown as Container['getOwnProfile'],
    updateOwnProfile: undefined as unknown as Container['updateOwnProfile'],
    listAccounts: undefined as unknown as Container['listAccounts'],
    getAccountDetail: undefined as unknown as Container['getAccountDetail'],
    createAccount: undefined as unknown as Container['createAccount'],
    updateAccountAdmin: undefined as unknown as Container['updateAccountAdmin'],
    suspendAccount: undefined as unknown as Container['suspendAccount'],
    activateAccount: undefined as unknown as Container['activateAccount'],
    deactivateAccount: undefined as unknown as Container['deactivateAccount'],
    listRoleCatalogue: undefined as unknown as Container['listRoleCatalogue'],
    grantRole: undefined as unknown as Container['grantRole'],
    revokeRole: undefined as unknown as Container['revokeRole'],
    getStudentDashboard: undefined as unknown as Container['getStudentDashboard'],
    listDoctors: undefined as unknown as Container['listDoctors'],
    getDoctor: undefined as unknown as Container['getDoctor'],
    createDoctor: undefined as unknown as Container['createDoctor'],
    updateDoctor: undefined as unknown as Container['updateDoctor'],
    deactivateDoctor: undefined as unknown as Container['deactivateDoctor'],
    deleteDoctor: undefined as unknown as Container['deleteDoctor'],
    listDutyRosters: undefined as unknown as Container['listDutyRosters'],
    createDutyRoster: undefined as unknown as Container['createDutyRoster'],
    updateDutyRoster: undefined as unknown as Container['updateDutyRoster'],
    deleteDutyRoster: undefined as unknown as Container['deleteDutyRoster'],    listClinicSessions: undefined as unknown as Container['listClinicSessions'],    getClinicSession: undefined as unknown as Container['getClinicSession'],    createClinicSession: undefined as unknown as Container['createClinicSession'],    updateClinicSession: undefined as unknown as Container['updateClinicSession'],    getSessionSlots: undefined as unknown as Container['getSessionSlots'],    startSession: undefined as unknown as Container['startSession'],    interruptSession: undefined as unknown as Container['interruptSession'],    completeSession: undefined as unknown as Container['completeSession'],    cancelSession: undefined as unknown as Container['cancelSession'],    unavailabilityRepository: undefined as unknown as Container['unavailabilityRepository'],    listUnavailability: undefined as unknown as Container['listUnavailability'],    previewUnavailability: undefined as unknown as Container['previewUnavailability'],    confirmUnavailability: undefined as unknown as Container['confirmUnavailability'],    deleteUnavailability: undefined as unknown as Container['deleteUnavailability'],    getPublicAvailability: undefined as unknown as Container['getPublicAvailability'],    listServiceCalendar: undefined as unknown as Container['listServiceCalendar'],    getPublicServiceCalendar: undefined as unknown as Container['getPublicServiceCalendar'],    createServiceCalendarEntries: undefined as unknown as Container['createServiceCalendarEntries'],    updateServiceCalendarEntry: undefined as unknown as Container['updateServiceCalendarEntry'],    deleteServiceCalendarEntry: undefined as unknown as Container['deleteServiceCalendarEntry'],
    appointmentRepository: undefined as unknown as Container['appointmentRepository'],
    getAvailability: undefined as unknown as Container['getAvailability'],
    bookAppointment: undefined as unknown as Container['bookAppointment'],
    listMyAppointments: undefined as unknown as Container['listMyAppointments'],
    getAppointmentDetail: undefined as unknown as Container['getAppointmentDetail'],
    cancelAppointment: undefined as unknown as Container['cancelAppointment'],
    getQueuePosition: undefined as unknown as Container['getQueuePosition'],
    bookingSuspensionRepository: undefined as unknown as Container['bookingSuspensionRepository'],
    getBookingSuspension: undefined as unknown as Container['getBookingSuspension'],
    getQueueConsole: undefined as unknown as Container['getQueueConsole'],
    getSessionQueue: undefined as unknown as Container['getSessionQueue'],
    checkInAppointment: undefined as unknown as Container['checkInAppointment'],
    advanceAppointment: undefined as unknown as Container['advanceAppointment'],
    markNoShow: undefined as unknown as Container['markNoShow'],
    reverseAppointmentStatus: undefined as unknown as Container['reverseAppointmentStatus'],
    markEmergency: undefined as unknown as Container['markEmergency'],
    recalculateSessionEstimates: undefined as unknown as Container['recalculateSessionEstimates'],
    recordConsultationMetrics: undefined as unknown as Container['recordConsultationMetrics'],
    expireUnstartedSessionBookings: undefined as unknown as Container['expireUnstartedSessionBookings'],
    registerWalkIn: undefined as unknown as Container['registerWalkIn'],
  };

  return { app: await buildApp(container), repository, sentEmails };
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

  it('GET /api/v1/auth/sso/login — 503 SSO_UNAVAILABLE with no IdP configured', async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/sso/login' });

    expect(response.statusCode).toBe(503);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('SSO_UNAVAILABLE');
  });

  it('GET /api/v1/auth/sso/login — 422 INVALID_REDIRECT for an absolute redirectTo', async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sso/login?redirectTo=https://evil.example.com',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('INVALID_REDIRECT');
  });

  it('GET /api/v1/auth/sso/callback — 403 SSO_STATE_MISMATCH with no pre-session cookie', async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/sso/callback?code=abc&state=xyz' });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('SSO_STATE_MISMATCH');
  });

  it('POST /api/v1/auth/password-reset/request — 202 with the uniform message for a real account', async () => {
    let sentEmails: SentEmail[];
    ({ app, sentEmails } = await buildTestApp());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: 'nusrat@diu.edu.bd' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json<{ message: string }>().message).toMatch(/reset link/);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.recipientId).toBe('0191f5aa-0000-7000-8000-000000000201');
    expect(typeof sentEmails[0]!.payload.resetLink).toBe('string');
  });

  it('POST /api/v1/auth/password-reset/request — identical 202 response for an unknown email, no email sent — API §0.4', async () => {
    let sentEmails: SentEmail[];
    ({ app, sentEmails } = await buildTestApp());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: 'nobody@diu.edu.bd' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json<{ message: string }>().message).toMatch(/reset link/);
    expect(sentEmails).toHaveLength(0);
  });

  it('POST /api/v1/auth/password-reset/request — 422 VALIDATION_FAILED for a non-institutional email', async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: 'nusrat@gmail.com' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('VALIDATION_FAILED');
  });

  it('POST /api/v1/auth/password-reset/confirm — 200 on success, and the new password can log in', async () => {
    let sentEmails: SentEmail[];
    ({ app, sentEmails } = await buildTestApp());

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: 'nusrat@diu.edu.bd' },
    });
    const resetLink = sentEmails[0]!.payload.resetLink as string;
    const token = new URL(resetLink).searchParams.get('token')!;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, newPassword: 'New correct horse battery 2!' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ message: string }>().message).toMatch(/password has been changed/i);

    const loginWithNewPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nusrat@diu.edu.bd', password: 'New correct horse battery 2!' },
    });
    expect(loginWithNewPassword.statusCode).toBe(200);
  });

  it('POST /api/v1/auth/password-reset/confirm — 422 RESET_TOKEN_INVALID for a bogus token', async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token: 'not-a-real-token', newPassword: 'New correct horse battery 2!' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('POST /api/v1/auth/password-reset/confirm — a consumed token cannot be reused', async () => {
    let sentEmails: SentEmail[];
    ({ app, sentEmails } = await buildTestApp());

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: 'nusrat@diu.edu.bd' },
    });
    const resetLink = sentEmails[0]!.payload.resetLink as string;
    const token = new URL(resetLink).searchParams.get('token')!;

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, newPassword: 'New correct horse battery 2!' },
    });
    const secondAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, newPassword: 'Yet another correct 3!' },
    });

    expect(secondAttempt.statusCode).toBe(422);
    expect(secondAttempt.json<ErrorEnvelopeBody>().error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('POST /api/v1/auth/password-reset/confirm — 422 VALIDATION_FAILED with itemized fields for a weak password', async () => {
    let sentEmails: SentEmail[];
    ({ app, sentEmails } = await buildTestApp());

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: 'nusrat@diu.edu.bd' },
    });
    const resetLink = sentEmails[0]!.payload.resetLink as string;
    const token = new URL(resetLink).searchParams.get('token')!;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, newPassword: 'weak' },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<ErrorEnvelopeBody & { error: { fields?: readonly unknown[] } }>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(body.error.fields)).toBe(true);
    expect(body.error.fields!.length).toBeGreaterThan(0);
  });
});
