import type { AuthenticatedRoleCode } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/bootstrap/app.js';
import type { Container } from '../../src/bootstrap/container.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { PolicyDecisionPoint } from '../../src/kernel/authz/policy-decision-point.js';
import { CsrfTokenService } from '../../src/kernel/identity/csrf.js';
import {
  CreateServiceCalendarEntriesHandler,
  DeleteServiceCalendarEntryHandler,
  GetPublicServiceCalendarQuery,
  ListServiceCalendarQuery,
  UpdateServiceCalendarEntryHandler,
  type ServiceCalendarEntry,
  type ServiceCalendarRepository,
} from '../../src/modules/config/index.js';
import {
  createAuthenticatedSubjectResolver,
  GetSessionQuery,
  LoginWithPasswordHandler,
  LogoutHandler,
  PasswordHasher,
  SessionIssuer,
  SsoCallbackHandler,
  SsoLoginHandler,
  type AccountSummary,
  type AccountWithCredential,
  type AuthenticationRepository,
  type SsoClient,
} from '../../src/modules/iam/index.js';
import { GetPublicAvailabilityQuery, type ClinicSessionRepository } from '../../src/modules/scheduling/index.js';
import { FixedClock } from '../support/fixed-clock.js';

const NOW = new Date('2026-08-03T14:00:00+06:00');
const PASSWORD = 'Correct horse battery 1!';

class InMemoryAuthenticationRepository implements AuthenticationRepository {
  constructor(private readonly accountsByEmail: Map<string, AccountWithCredential & { readonly roles: readonly AuthenticatedRoleCode[] }>) {}

  findAccountWithCredentialByEmail(email: string): Promise<AccountWithCredential | null> {
    return Promise.resolve(this.accountsByEmail.get(email.toLowerCase()) ?? null);
  }

  findAccountById(userAccountId: string): Promise<AccountSummary | null> {
    for (const account of this.accountsByEmail.values()) {
      if (account.id === userAccountId) {
        const { id, email, fullName, status, version } = account;
        return Promise.resolve({ id, email, fullName, status, version });
      }
    }
    return Promise.resolve(null);
  }

  loadActiveRoleCodes(userAccountId: string) {
    for (const account of this.accountsByEmail.values()) {
      if (account.id === userAccountId) return Promise.resolve(account.roles);
    }
    return Promise.resolve([]);
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

const CALENDAR_ENTRY: ServiceCalendarEntry = {
  id: 'entry-1',
  locationId: 'location-1',
  calendarDate: '2026-08-15',
  isServiceDay: false,
  reason: 'National Mourning Day',
  createdBy: 'adm-1',
  createdByName: 'DIU IT',
  createdAt: NOW,
  version: 1,
};

async function buildTestApp(): Promise<{ app: FastifyInstance }> {
  const passwordHasher = new PasswordHasher();
  const admAccount: AccountWithCredential & { readonly roles: readonly AuthenticatedRoleCode[] } = {
    id: 'adm-1',
    email: 'adm@diu.edu.bd',
    fullName: 'DIU IT Admin',
    status: 'active',
    version: 1,
    passwordHash: await passwordHasher.hash(PASSWORD),
    failedAttempts: 0,
    lockedUntil: null,
    roles: ['ADM'],
  };
  const studentAccount: AccountWithCredential & { readonly roles: readonly AuthenticatedRoleCode[] } = {
    id: 'student-1',
    email: 'student@diu.edu.bd',
    fullName: 'A Student',
    status: 'active',
    version: 1,
    passwordHash: await passwordHasher.hash(PASSWORD),
    failedAttempts: 0,
    lockedUntil: null,
    roles: ['STU'],
  };
  const authenticationRepository = new InMemoryAuthenticationRepository(
    new Map([
      [admAccount.email, admAccount],
      [studentAccount.email, studentAccount],
    ]),
  );
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

  const policyValues: Record<string, number> = {
    'auth.lockout.maxAttempts': 5,
    'auth.lockout.durationMinutes': 15,
    'auth.session.idleTimeoutMinutes.student': 30,
    'auth.session.idleTimeoutMinutes.staff': 15,
    'scheduling.publicationWindowDays': 7,
  };
  const policyStore = { getRequiredInteger: (key: string) => Promise.resolve(policyValues[key]!) } as unknown as Container['policyStore'];

  const auditRecorder = { recordChange: () => Promise.resolve(), recordDenial: () => Promise.resolve(), recordDataAccess: () => Promise.resolve() } as unknown as AuditRecorder;

  const sessionIssuer = new SessionIssuer(authenticationRepository, sessionStore, csrfTokenService, policyStore);
  const loginWithPassword = new LoginWithPasswordHandler(authenticationRepository, passwordHasher, sessionIssuer, policyStore, auditRecorder, () => Promise.resolve(), clock);
  const getSession = new GetSessionQuery(authenticationRepository, sessionStore, csrfTokenService, policyStore);
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
  const ssoCallback = new SsoCallbackHandler(unconfiguredSsoClient, authenticationRepository, sessionIssuer, auditRecorder);

  const clinicSessionRepository = {
    findDefaultLocationId: vi.fn().mockResolvedValue('location-1'),
    listPublicAvailability: vi.fn().mockResolvedValue([{ date: '2026-08-03', isServiceDay: true, closureReason: null, sessions: [] }]),
  } as unknown as ClinicSessionRepository;
  const getPublicAvailability = new GetPublicAvailabilityQuery(clinicSessionRepository, policyStore, clock);

  const serviceCalendarRepository: ServiceCalendarRepository = {
    findDefaultLocationId: vi.fn().mockResolvedValue('location-1'),
    listEntries: vi.fn().mockResolvedValue([CALENDAR_ENTRY]),
    findEntryById: vi.fn().mockResolvedValue(CALENDAR_ENTRY),
    createEntries: vi.fn().mockResolvedValue({ outcome: 'created', items: [CALENDAR_ENTRY], conflictingSessions: [] }),
    findConflictingSessions: vi.fn().mockResolvedValue([]),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
  };
  const listServiceCalendar = new ListServiceCalendarQuery(serviceCalendarRepository);
  const getPublicServiceCalendar = new GetPublicServiceCalendarQuery(serviceCalendarRepository);
  const createServiceCalendarEntries = new CreateServiceCalendarEntriesHandler(serviceCalendarRepository, auditRecorder);
  const updateServiceCalendarEntry = new UpdateServiceCalendarEntryHandler(serviceCalendarRepository, auditRecorder);
  const deleteServiceCalendarEntry = new DeleteServiceCalendarEntryHandler(serviceCalendarRepository, auditRecorder, clock);

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
    resolveSubject: createAuthenticatedSubjectResolver(getSession),
    listActiveAnnouncements: undefined as unknown as Container['listActiveAnnouncements'],
    loginWithPassword,
    logout,
    getSession,
    ssoLogin,
    ssoCallback,
    requestPasswordReset: undefined as unknown as Container['requestPasswordReset'],
    confirmPasswordReset: undefined as unknown as Container['confirmPasswordReset'],
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
    deleteDutyRoster: undefined as unknown as Container['deleteDutyRoster'],
    listClinicSessions: undefined as unknown as Container['listClinicSessions'],
    getClinicSession: undefined as unknown as Container['getClinicSession'],
    createClinicSession: undefined as unknown as Container['createClinicSession'],
    updateClinicSession: undefined as unknown as Container['updateClinicSession'],
    getSessionSlots: undefined as unknown as Container['getSessionSlots'],
    startSession: undefined as unknown as Container['startSession'],
    interruptSession: undefined as unknown as Container['interruptSession'],
    completeSession: undefined as unknown as Container['completeSession'],
    cancelSession: undefined as unknown as Container['cancelSession'],
    unavailabilityRepository: undefined as unknown as Container['unavailabilityRepository'],
    listUnavailability: undefined as unknown as Container['listUnavailability'],
    previewUnavailability: undefined as unknown as Container['previewUnavailability'],
    confirmUnavailability: undefined as unknown as Container['confirmUnavailability'],
    deleteUnavailability: undefined as unknown as Container['deleteUnavailability'],
    getPublicAvailability,
    listServiceCalendar,
    getPublicServiceCalendar,
    createServiceCalendarEntries,
    updateServiceCalendarEntry,
    deleteServiceCalendarEntry,
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
  };

  return { app: await buildApp(container) };
}

async function loginAs(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
  return response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

describe('Public projections — contract (API §2.2, §2.6)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('GET /public/availability — 200 with no session, 60s cache header, documented shape', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'GET', url: '/api/v1/public/availability' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.json()).toEqual({
      days: [{ date: '2026-08-03', isServiceDay: true, closureReason: null, sessions: [] }],
      asOf: expect.any(String),
      publicationWindowDays: 7,
    });
  });

  it('GET /public/service-calendar — 200 with no session, 60s cache header', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'GET', url: '/api/v1/public/service-calendar' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.json()).toEqual({ items: [{ date: '2026-08-15', isServiceDay: false, reason: 'National Mourning Day' }] });
  });
});

describe('Service calendar admin routes — contract (API §8.4-8.6)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('POST /service-calendar — 401 with no session, 403 for a student, 201 for ADM', async () => {
    ({ app } = await buildTestApp());
    const payload = { fromDate: '2026-08-15', reason: 'National Mourning Day' };

    const unauth = await app.inject({ method: 'POST', url: '/api/v1/service-calendar', payload });
    expect(unauth.statusCode).toBe(401);

    const studentCookie = await loginAs(app, 'student@diu.edu.bd');
    const forbidden = await app.inject({ method: 'POST', url: '/api/v1/service-calendar', headers: { cookie: studentCookie }, payload });
    expect(forbidden.statusCode).toBe(403);

    const admCookie = await loginAs(app, 'adm@diu.edu.bd');
    const created = await app.inject({ method: 'POST', url: '/api/v1/service-calendar', headers: { cookie: admCookie }, payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ created: 1, items: [expect.objectContaining({ id: 'entry-1', date: '2026-08-15' })], conflictingSessions: [] });
  });

  it('GET /service-calendar (maintenance view) — 200', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'GET', url: '/api/v1/service-calendar' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [expect.objectContaining({ id: 'entry-1' })] });
  });

  it('DELETE /service-calendar/{id} — 403 for a student', async () => {
    ({ app } = await buildTestApp());
    const studentCookie = await loginAs(app, 'student@diu.edu.bd');
    const response = await app.inject({ method: 'DELETE', url: '/api/v1/service-calendar/entry-1', headers: { cookie: studentCookie } });
    expect(response.statusCode).toBe(403);
  });
});
