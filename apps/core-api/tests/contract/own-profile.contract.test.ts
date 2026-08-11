import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/bootstrap/app.js';
import type { Container } from '../../src/bootstrap/container.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { PolicyDecisionPoint } from '../../src/kernel/authz/policy-decision-point.js';
import { CsrfTokenService } from '../../src/kernel/identity/csrf.js';
import {
  createAuthenticatedSubjectResolver,
  GetOwnProfileQuery,
  GetSessionQuery,
  LoginWithPasswordHandler,
  LogoutHandler,
  PasswordHasher,
  SessionIssuer,
  SsoCallbackHandler,
  SsoLoginHandler,
  UpdateOwnProfileHandler,
  type AccountSummary,
  type AccountWithCredential,
  type AuthenticationRepository,
  type OwnProfileAccount,
  type OwnProfileRepository,
  type SsoClient,
  type StudentProfile,
  type UpdateFullNameOutcome,
} from '../../src/modules/iam/index.js';
import { FixedClock } from '../support/fixed-clock.js';

interface ErrorEnvelopeBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly correlationId: string;
    readonly fields?: readonly { readonly field: string }[];
    readonly details?: { readonly current?: unknown };
  };
}

interface ProfileBody {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: string;
  readonly roles: readonly string[];
  readonly authMethod: string;
  readonly studentProfile: StudentProfile | null;
  readonly version: number;
}

const NOW = new Date('2026-08-03T14:00:00+06:00');
const PASSWORD = 'Correct horse battery 1!';
const ACCOUNT_ID = '0191f5aa-0000-7000-8000-000000000301';

class InMemoryAuthenticationRepository implements AuthenticationRepository {
  constructor(private readonly account: AccountWithCredential) {}

  findAccountWithCredentialByEmail(email: string): Promise<AccountWithCredential | null> {
    if (email.toLowerCase() !== this.account.email.toLowerCase()) return Promise.resolve(null);
    return Promise.resolve(this.account);
  }

  findAccountById(userAccountId: string): Promise<AccountSummary | null> {
    if (userAccountId !== this.account.id) return Promise.resolve(null);
    const { id, email, fullName, status, version } = this.account;
    return Promise.resolve({ id, email, fullName, status, version });
  }

  loadActiveRoleCodes() {
    return Promise.resolve(['STU'] as const);
  }

  recordFailedAttempt(): Promise<void> {
    return Promise.resolve();
  }

  resetFailedAttempts(): Promise<void> {
    return Promise.resolve();
  }

  recordLoginAttempt(): Promise<void> {
    return Promise.resolve();
  }

  findOrProvisionBySsoSubject(): Promise<AccountSummary> {
    throw new Error('not exercised by this contract suite');
  }
}

class InMemoryOwnProfileRepository implements OwnProfileRepository {
  constructor(
    private account: OwnProfileAccount,
    private readonly studentProfile: StudentProfile | null = null,
  ) {}

  findAccountById(userAccountId: string): Promise<OwnProfileAccount | null> {
    if (userAccountId !== this.account.id) return Promise.resolve(null);
    return Promise.resolve(this.account);
  }

  findStudentProfile(userAccountId: string): Promise<StudentProfile | null> {
    if (userAccountId !== this.account.id) return Promise.resolve(null);
    return Promise.resolve(this.studentProfile);
  }

  updateFullName(input: {
    readonly userAccountId: string;
    readonly fullName: string | undefined;
    readonly expectedVersion: number;
  }): Promise<UpdateFullNameOutcome> {
    if (input.expectedVersion !== this.account.version) {
      return Promise.resolve({ outcome: 'stale' });
    }
    this.account = {
      ...this.account,
      fullName: input.fullName ?? this.account.fullName,
      version: this.account.version + 1,
    };
    return Promise.resolve({ outcome: 'updated', account: this.account });
  }
}

async function buildTestApp(): Promise<{ app: FastifyInstance }> {
  const passwordHasher = new PasswordHasher();
  const account: AccountWithCredential = {
    id: ACCOUNT_ID,
    email: 'nusrat@diu.edu.bd',
    fullName: 'Nusrat Jahan',
    status: 'active',
    version: 1,
    passwordHash: await passwordHasher.hash(PASSWORD),
    failedAttempts: 0,
    lockedUntil: null,
  };
  const repository = new InMemoryAuthenticationRepository(account);
  const ownProfileRepository = new InMemoryOwnProfileRepository({
    id: ACCOUNT_ID,
    email: 'nusrat@diu.edu.bd',
    fullName: 'Nusrat Jahan',
    status: 'active',
    version: 4,
    authMethod: 'local',
  });
  const clock = new FixedClock(NOW);
  const csrfTokenService = new CsrfTokenService('a'.repeat(32));

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

  const auditRecorder = {
    recordChange: () => Promise.resolve(),
    recordDenial: () => Promise.resolve(),
  } as unknown as AuditRecorder;

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

  const getOwnProfile = new GetOwnProfileQuery(ownProfileRepository, repository);
  const updateOwnProfile = new UpdateOwnProfileHandler(ownProfileRepository, repository, auditRecorder, clock);

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
    // The real PDP — this suite's whole point is proving the `own-profile`
    // `scope: 'own'` matrix rule and the PEP's `isOwner` wiring actually
    // permit a real session, not just that the PDP is called.
    pdp: new PolicyDecisionPoint(),
    passwordHasher,
    sessionStore,
    csrfTokenService,
    // The real cookie->session->roles resolver — unlike the auth-route
    // contract tests, GET/PATCH /me are PEP-gated, so ANON must be rejected
    // and a real session's roles must reach the PDP.
    resolveSubject: createAuthenticatedSubjectResolver(getSession),
    listActiveAnnouncements: undefined as unknown as Container['listActiveAnnouncements'],
    loginWithPassword,
    logout,
    getSession,
    ssoLogin,
    ssoCallback,
    requestPasswordReset: undefined as unknown as Container['requestPasswordReset'],
    confirmPasswordReset: undefined as unknown as Container['confirmPasswordReset'],
    getOwnProfile,
    updateOwnProfile,
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
  };

  return { app: await buildApp(container) };
}

async function loginAndGetCookie(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'nusrat@diu.edu.bd', password: PASSWORD },
  });
  return response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

describe('Own profile routes — contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1/me — 401 with no session', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/me — 200 with the full profile shape for a real session', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAndGetCookie(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json<ProfileBody>();
    expect(Object.keys(body).sort()).toEqual(
      ['authMethod', 'email', 'fullName', 'roles', 'status', 'studentProfile', 'userId', 'version'].sort(),
    );
    expect(body).toMatchObject({
      userId: ACCOUNT_ID,
      email: 'nusrat@diu.edu.bd',
      status: 'active',
      roles: ['STU'],
      authMethod: 'local',
      studentProfile: null,
      version: 4,
    });
  });

  it('PATCH /api/v1/me — 200, updates fullName and increments version', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAndGetCookie(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { fullName: 'Nusrat Jahan Mim', version: 4 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ProfileBody>();
    expect(body.fullName).toBe('Nusrat Jahan Mim');
    expect(body.version).toBe(5);
  });

  it('PATCH /api/v1/me — 422 FIELD_NOT_EDITABLE naming every disallowed field present', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAndGetCookie(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { fullName: 'New Name', version: 4, email: 'someone@diu.edu.bd', roles: ['ADM'] },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<ErrorEnvelopeBody>();
    expect(body.error.code).toBe('FIELD_NOT_EDITABLE');
    expect(body.error.fields?.map((f) => f.field).sort()).toEqual(['email', 'roles']);
  });

  it('PATCH /api/v1/me — 422 VALIDATION_FAILED when version is missing', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAndGetCookie(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { fullName: 'New Name' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('VALIDATION_FAILED');
  });

  it('PATCH /api/v1/me — 409 CONFLICT_STALE_VERSION with the current profile re-presented — VR-92/EC-19', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAndGetCookie(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { fullName: 'New Name', version: 999 },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<ErrorEnvelopeBody>();
    expect(body.error.code).toBe('CONFLICT_STALE_VERSION');
    expect(body.error.details?.current).toMatchObject({ userId: ACCOUNT_ID, version: 4 });
  });
});
