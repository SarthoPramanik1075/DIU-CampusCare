import type { AuthenticatedRoleCode } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/bootstrap/app.js';
import type { Container } from '../../src/bootstrap/container.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { PolicyDecisionPoint } from '../../src/kernel/authz/policy-decision-point.js';
import { CsrfTokenService } from '../../src/kernel/identity/csrf.js';
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
import {
  CancelSessionHandler,
  CompleteSessionHandler,
  ConfirmUnavailabilityHandler,
  CreateClinicSessionHandler,
  CreateDutyRosterHandler,
  DeleteDutyRosterHandler,
  DeleteUnavailabilityHandler,
  GetClinicSessionQuery,
  GetSessionSlotsQuery,
  InterruptSessionHandler,
  ListClinicSessionsQuery,
  ListDutyRostersQuery,
  ListUnavailabilityQuery,
  PreviewUnavailabilityHandler,
  StartSessionHandler,
  UpdateClinicSessionHandler,
  UpdateDutyRosterHandler,
  type ClinicSessionListItem,
  type ClinicSessionRepository,
  type DutyRoster,
  type DutyRosterRepository,
  type UnavailabilityRepository,
} from '../../src/modules/scheduling/index.js';
import { FixedClock } from '../support/fixed-clock.js';

interface ErrorEnvelopeBody {
  readonly error: { readonly code: string; readonly message: string; readonly correlationId: string; readonly details?: Record<string, unknown> };
}

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

const ROSTER: DutyRoster = { rosterId: 'roster-1', doctorId: 'doctor-1', weekday: 1, startsAtLocal: '09:00', endsAtLocal: '13:00', effectiveFrom: '2026-01-01', effectiveTo: null, isActive: true, version: 1 };

const SESSION: ClinicSessionListItem = {
  sessionId: 'session-1',
  doctorId: 'doctor-1',
  doctorName: 'Dr. Rahman',
  locationId: 'location-1',
  sessionDate: '2026-08-10',
  startsAt: new Date('2026-08-10T03:00:00Z'),
  endsAt: new Date('2026-08-10T07:00:00Z'),
  slotLengthMinutes: 10,
  walkInAllocationPct: 30,
  totalSlotCount: 24,
  bookableSlotCount: 16,
  bookedSlotCount: 0,
  status: 'scheduled',
  nextSerial: 1,
  actuallyStartedAt: null,
  actuallyEndedAt: null,
  changeReason: null,
  isOverride: true,
  version: 1,
};

async function buildTestApp(): Promise<{ app: FastifyInstance }> {
  const passwordHasher = new PasswordHasher();
  const mcsAccount: AccountWithCredential & { readonly roles: readonly AuthenticatedRoleCode[] } = {
    id: 'mcs-1',
    email: 'mcs@diu.edu.bd',
    fullName: 'Front Desk Staff',
    status: 'active',
    version: 1,
    passwordHash: await passwordHasher.hash(PASSWORD),
    failedAttempts: 0,
    lockedUntil: null,
    roles: ['MCS'],
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
      [mcsAccount.email, mcsAccount],
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
    'scheduling.session.defaultSlotLengthMinutes': 10,
    'scheduling.session.defaultWalkInAllocationPct': 30,
    'scheduling.session.bookingCutoffMinutesBeforeStart': 0,
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

  const dutyRosterRepository: DutyRosterRepository = {
    listDutyRosters: vi.fn().mockResolvedValue([ROSTER]),
    findDutyRosterById: vi.fn().mockResolvedValue(ROSTER),
    doctorExists: vi.fn().mockResolvedValue(true),
    createDutyRoster: vi.fn().mockResolvedValue({ outcome: 'created', roster: ROSTER }),
    updateDutyRoster: vi.fn(),
    deleteDutyRoster: vi.fn().mockResolvedValue({ outcome: 'deleted' }),
  };
  const listDutyRosters = new ListDutyRostersQuery(dutyRosterRepository);
  const createDutyRoster = new CreateDutyRosterHandler(dutyRosterRepository, auditRecorder);
  const updateDutyRoster = new UpdateDutyRosterHandler(dutyRosterRepository, auditRecorder);
  const deleteDutyRoster = new DeleteDutyRosterHandler(dutyRosterRepository, auditRecorder);

  const clinicSessionRepository: ClinicSessionRepository = {
    listClinicSessions: vi.fn().mockResolvedValue([SESSION]),
    findClinicSessionById: vi.fn().mockResolvedValue(SESSION),
    findDoctorLocationId: vi.fn().mockResolvedValue('location-1'),
    findServiceCalendarClosure: vi.fn().mockResolvedValue(null),
    countBookedAppointments: vi.fn().mockResolvedValue(0),
    createClinicSession: vi.fn().mockResolvedValue({ outcome: 'created', session: SESSION }),
    updateClinicSession: vi.fn(),
    listSessionSlots: vi.fn().mockResolvedValue([]),
    getQueueSummary: vi.fn().mockResolvedValue({ waiting: 0, completed: 0, noShow: 0, inConsultation: 0 }),
    listOpenAppointments: vi.fn().mockResolvedValue([]),
    startSession: vi.fn().mockResolvedValue({ outcome: 'started', session: { ...SESSION, status: 'started', actuallyStartedAt: NOW, version: 2 } }),
    interruptSession: vi.fn(),
    countInConsultation: vi.fn(),
    completeSession: vi.fn(),
    cancelSession: vi.fn(),
    findDefaultLocationId: vi.fn().mockResolvedValue('location-1'),
    listPublicAvailability: vi.fn().mockResolvedValue([]),
  };
  const listClinicSessions = new ListClinicSessionsQuery(clinicSessionRepository);
  const getClinicSession = new GetClinicSessionQuery(clinicSessionRepository);
  const createClinicSession = new CreateClinicSessionHandler(clinicSessionRepository, policyStore, auditRecorder, clock);
  const updateClinicSession = new UpdateClinicSessionHandler(clinicSessionRepository, auditRecorder, clock);
  const getSessionSlots = new GetSessionSlotsQuery(clinicSessionRepository, policyStore);
  const startSession = new StartSessionHandler(clinicSessionRepository, auditRecorder, clock);
  const interruptSession = new InterruptSessionHandler(clinicSessionRepository, auditRecorder, () => Promise.resolve());
  const completeSession = new CompleteSessionHandler(clinicSessionRepository, auditRecorder, clock, () => Promise.resolve());
  const cancelSession = new CancelSessionHandler(clinicSessionRepository, auditRecorder, () => Promise.resolve());

  const unavailabilityRepository: UnavailabilityRepository = {
    doctorExists: vi.fn().mockResolvedValue(true),
    findOverlappingUnavailability: vi.fn().mockResolvedValue(null),
    computeImpact: vi.fn().mockResolvedValue({ affectedSessions: 0, affectedAppointments: [], alternativeAvailability: [] }),
    createPreview: vi.fn().mockResolvedValue({ previewToken: 'preview-1' }),
    findPreview: vi.fn().mockResolvedValue(null),
    createUnavailability: vi.fn(),
    listUnavailability: vi.fn().mockResolvedValue([]),
    findUnavailabilityById: vi.fn(),
    deleteUnavailability: vi.fn(),
  };
  const listUnavailability = new ListUnavailabilityQuery(unavailabilityRepository);
  const previewUnavailability = new PreviewUnavailabilityHandler(unavailabilityRepository, auditRecorder, clock);
  const confirmUnavailability = new ConfirmUnavailabilityHandler(unavailabilityRepository, auditRecorder, clock, () => Promise.resolve());
  const deleteUnavailability = new DeleteUnavailabilityHandler(unavailabilityRepository, auditRecorder, clock);

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
    listDutyRosters,
    createDutyRoster,
    updateDutyRoster,
    deleteDutyRoster,
    listClinicSessions,
    getClinicSession,
    createClinicSession,
    updateClinicSession,
    getSessionSlots,
    startSession,
    interruptSession,
    completeSession,
    cancelSession,
    unavailabilityRepository,
    listUnavailability,
    previewUnavailability,
    confirmUnavailability,
    deleteUnavailability,
    getPublicAvailability: undefined as unknown as Container['getPublicAvailability'],
    listServiceCalendar: undefined as unknown as Container['listServiceCalendar'],
    getPublicServiceCalendar: undefined as unknown as Container['getPublicServiceCalendar'],
    createServiceCalendarEntries: undefined as unknown as Container['createServiceCalendarEntries'],
    updateServiceCalendarEntry: undefined as unknown as Container['updateServiceCalendarEntry'],
    deleteServiceCalendarEntry: undefined as unknown as Container['deleteServiceCalendarEntry'],
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
  };

  return { app: await buildApp(container) };
}

async function loginAs(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
  return response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

describe('Duty roster routes — contract (API §3.2)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('GET /doctors/{id}/duty-rosters works with no session — matrix grants ANON read', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'GET', url: '/api/v1/doctors/doctor-1/duty-rosters' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [expect.objectContaining({ rosterId: 'roster-1' })] });
  });

  it('POST — 401 with no session, 403 for a student, 201 for MCS', async () => {
    ({ app } = await buildTestApp());
    const payload = { weekday: 1, startsAtLocal: '09:00', endsAtLocal: '13:00', effectiveFrom: '2026-01-01' };

    const unauth = await app.inject({ method: 'POST', url: '/api/v1/doctors/doctor-1/duty-rosters', payload });
    expect(unauth.statusCode).toBe(401);

    const studentCookie = await loginAs(app, 'student@diu.edu.bd');
    const forbidden = await app.inject({ method: 'POST', url: '/api/v1/doctors/doctor-1/duty-rosters', headers: { cookie: studentCookie }, payload });
    expect(forbidden.statusCode).toBe(403);

    const mcsCookie = await loginAs(app, 'mcs@diu.edu.bd');
    const created = await app.inject({ method: 'POST', url: '/api/v1/doctors/doctor-1/duty-rosters', headers: { cookie: mcsCookie }, payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(expect.objectContaining({ rosterId: 'roster-1', weekday: 1 }));
  });

  it('DELETE — 403 for a student, 204 for MCS', async () => {
    ({ app } = await buildTestApp());
    const studentCookie = await loginAs(app, 'student@diu.edu.bd');
    const forbidden = await app.inject({ method: 'DELETE', url: '/api/v1/duty-rosters/roster-1', headers: { cookie: studentCookie }, payload: { reason: 'Doctor moved to the afternoon clinic' } });
    expect(forbidden.statusCode).toBe(403);

    const mcsCookie = await loginAs(app, 'mcs@diu.edu.bd');
    const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/duty-rosters/roster-1', headers: { cookie: mcsCookie }, payload: { reason: 'Doctor moved to the afternoon clinic' } });
    expect(deleted.statusCode).toBe(204);
  });
});

describe('Clinic session routes — contract (API §3.3)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('GET /sessions works with no session — matrix grants ANON read', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [expect.objectContaining({ sessionId: 'session-1' })], nextCursor: null });
  });

  it('POST /sessions — 401 with no session, 403 for a student, 201 for MCS with derived slot counts', async () => {
    ({ app } = await buildTestApp());
    const payload = { doctorId: 'doctor-1', sessionDate: '2026-08-10', startsAt: '2026-08-10T09:00:00+06:00', endsAt: '2026-08-10T13:00:00+06:00' };

    const unauth = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload });
    expect(unauth.statusCode).toBe(401);

    const studentCookie = await loginAs(app, 'student@diu.edu.bd');
    const forbidden = await app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { cookie: studentCookie }, payload });
    expect(forbidden.statusCode).toBe(403);

    const mcsCookie = await loginAs(app, 'mcs@diu.edu.bd');
    const created = await app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { cookie: mcsCookie }, payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(expect.objectContaining({ sessionId: 'session-1', totalSlotCount: 24, bookableSlotCount: 16 }));
  });

  it('POST /sessions/{id}/start — 403 for a student, 200 for MCS with actuallyStartedAt set', async () => {
    ({ app } = await buildTestApp());
    const studentCookie = await loginAs(app, 'student@diu.edu.bd');
    const forbidden = await app.inject({ method: 'POST', url: '/api/v1/sessions/session-1/start', headers: { cookie: studentCookie }, payload: { version: 1 } });
    expect(forbidden.statusCode).toBe(403);

    const mcsCookie = await loginAs(app, 'mcs@diu.edu.bd');
    const started = await app.inject({ method: 'POST', url: '/api/v1/sessions/session-1/start', headers: { cookie: mcsCookie }, payload: { version: 1 } });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toEqual(expect.objectContaining({ status: 'started' }));
  });

  it('GET /sessions/{id}/slots — 200 with no session at all, documented shape', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-1/slots' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sessionId: 'session-1', slotLengthMinutes: 10, bookingClosesAt: expect.any(String), items: [], summary: { bookable: 0, booked: 0, remaining: 0 } });
  });
});

describe('Doctor unavailability routes — contract (API §3.4)', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('impact-preview — 401 with no session, 403 for a student, 200 for MCS', async () => {
    ({ app } = await buildTestApp());
    const payload = { startDate: '2026-08-20', endDate: '2026-08-24', reason: 'Annual leave approved by the medical director' };

    const unauth = await app.inject({ method: 'POST', url: '/api/v1/doctors/doctor-1/unavailability/impact-preview', payload });
    expect(unauth.statusCode).toBe(401);

    const studentCookie = await loginAs(app, 'student@diu.edu.bd');
    const forbidden = await app.inject({ method: 'POST', url: '/api/v1/doctors/doctor-1/unavailability/impact-preview', headers: { cookie: studentCookie }, payload });
    expect(forbidden.statusCode).toBe(403);

    const mcsCookie = await loginAs(app, 'mcs@diu.edu.bd');
    const preview = await app.inject({ method: 'POST', url: '/api/v1/doctors/doctor-1/unavailability/impact-preview', headers: { cookie: mcsCookie }, payload });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual(expect.objectContaining({ previewToken: 'preview-1', affectedSessions: 0, affectedAppointments: [] }));
  });

  it('confirm without a valid previewToken — 409 PREVIEW_REQUIRED', async () => {
    ({ app } = await buildTestApp());
    const mcsCookie = await loginAs(app, 'mcs@diu.edu.bd');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/doctors/doctor-1/unavailability',
      headers: { cookie: mcsCookie },
      payload: { previewToken: 'nonexistent-token', startDate: '2026-08-20', endDate: '2026-08-24', reason: 'Annual leave approved by the medical director' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('PREVIEW_REQUIRED');
  });
});
