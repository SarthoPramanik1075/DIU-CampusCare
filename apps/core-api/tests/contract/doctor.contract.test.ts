import type { AuthenticatedRoleCode } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

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
  CreateDoctorHandler,
  DeactivateDoctorHandler,
  DeleteDoctorHandler,
  GetDoctorQuery,
  ListDoctorsQuery,
  UpdateDoctorHandler,
  type CreateDoctorInput,
  type CreateDoctorResult,
  type DeactivateDoctorOutcome,
  type DeleteDoctorOutcome,
  type DoctorDetail,
  type DoctorListFilter,
  type DoctorListPage,
  type DoctorRepository,
  type UpdateDoctorInput,
  type UpdateDoctorOutcome,
} from '../../src/modules/scheduling/index.js';
import { FixedClock } from '../support/fixed-clock.js';

interface ErrorEnvelopeBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly correlationId: string;
    readonly details?: Record<string, unknown>;
  };
}

const NOW = new Date('2026-08-03T14:00:00+06:00');
const PASSWORD = 'Correct horse battery 1!';
const LOCATION_ID = 'location-1';

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

class InMemoryDoctorRepository implements DoctorRepository {
  private doctors = new Map<string, DoctorDetail>();
  private nextId = 1;
  private linkedAccounts = new Set<string>();

  findDefaultLocationId(): Promise<string> {
    return Promise.resolve(LOCATION_ID);
  }

  listDoctors(filter: DoctorListFilter): Promise<DoctorListPage> {
    let items = [...this.doctors.values()];
    if (filter.isActive !== undefined) items = items.filter((d) => d.isActive === filter.isActive);
    return Promise.resolve({ items, nextCursor: null });
  }

  findDoctorDetailById(doctorId: string): Promise<DoctorDetail | null> {
    return Promise.resolve(this.doctors.get(doctorId) ?? null);
  }

  isUserAccountLinked(userAccountId: string): Promise<boolean> {
    return Promise.resolve(this.linkedAccounts.has(userAccountId));
  }

  createDoctor(input: CreateDoctorInput): Promise<CreateDoctorResult> {
    if (input.userAccountId !== null && this.linkedAccounts.has(input.userAccountId)) {
      return Promise.resolve({ outcome: 'account_already_linked' });
    }
    const doctorId = `doctor-${String(this.nextId++)}`;
    const doctor: DoctorDetail = {
      doctorId,
      userAccountId: input.userAccountId,
      fullName: input.fullName,
      designation: input.designation,
      specialisation: input.specialisation,
      photoUrl: input.photoUrl,
      isActive: true,
      activeRosterCount: 0,
      upcomingSessionCount: 0,
      version: 1,
    };
    this.doctors.set(doctorId, doctor);
    if (input.userAccountId !== null) this.linkedAccounts.add(input.userAccountId);
    return Promise.resolve({ outcome: 'created', doctor });
  }

  updateDoctor(input: UpdateDoctorInput): Promise<UpdateDoctorOutcome> {
    const current = this.doctors.get(input.doctorId);
    if (current === undefined) return Promise.resolve({ outcome: 'not_found' });
    if (current.version !== input.expectedVersion) return Promise.resolve({ outcome: 'stale' });

    const updated: DoctorDetail = {
      ...current,
      fullName: input.fullName ?? current.fullName,
      designation: input.designation === undefined ? current.designation : input.designation,
      specialisation: input.specialisation === undefined ? current.specialisation : input.specialisation,
      photoUrl: input.photoUrl === undefined ? current.photoUrl : input.photoUrl,
      version: current.version + 1,
    };
    this.doctors.set(input.doctorId, updated);
    return Promise.resolve({ outcome: 'updated', doctor: updated });
  }

  deactivateDoctor(doctorId: string, expectedVersion: number): Promise<DeactivateDoctorOutcome> {
    const current = this.doctors.get(doctorId);
    if (current === undefined) return Promise.resolve({ outcome: 'not_found' });
    if (current.version !== expectedVersion) return Promise.resolve({ outcome: 'stale' });

    const updated: DoctorDetail = { ...current, isActive: false, version: current.version + 1 };
    this.doctors.set(doctorId, updated);
    return Promise.resolve({ outcome: 'deactivated', doctor: updated, affectedUpcomingSessions: current.upcomingSessionCount });
  }

  countAppointmentHistory(): Promise<number> {
    return Promise.resolve(0);
  }

  deleteDoctor(doctorId: string): Promise<DeleteDoctorOutcome> {
    if (!this.doctors.has(doctorId)) return Promise.resolve({ outcome: 'not_found' });
    this.doctors.delete(doctorId);
    return Promise.resolve({ outcome: 'deleted' });
  }
}

async function buildTestApp(): Promise<{ app: FastifyInstance; doctorRepository: InMemoryDoctorRepository }> {
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
    recordDataAccess: () => Promise.resolve(),
  } as unknown as AuditRecorder;

  const sessionIssuer = new SessionIssuer(authenticationRepository, sessionStore, csrfTokenService, policyStore);
  const loginWithPassword = new LoginWithPasswordHandler(
    authenticationRepository,
    passwordHasher,
    sessionIssuer,
    policyStore,
    auditRecorder,
    () => Promise.resolve(),
    clock,
  );
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

  const doctorRepository = new InMemoryDoctorRepository();
  const listDoctors = new ListDoctorsQuery(doctorRepository);
  const getDoctor = new GetDoctorQuery(doctorRepository);
  const createDoctor = new CreateDoctorHandler(doctorRepository, auditRecorder);
  const updateDoctor = new UpdateDoctorHandler(doctorRepository, auditRecorder);
  const deactivateDoctor = new DeactivateDoctorHandler(doctorRepository, auditRecorder);
  const deleteDoctor = new DeleteDoctorHandler(doctorRepository, auditRecorder);

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
    listDoctors,
    getDoctor,
    createDoctor,
    updateDoctor,
    deactivateDoctor,
    deleteDoctor,
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
  };

  return { app: await buildApp(container), doctorRepository };
}

async function loginAs(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
  return response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

describe('Doctor administration routes — contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('GET /doctors and GET /doctors/{id} work with no session at all — API §3.1 "Auth: None"', async () => {
    ({ app } = await buildTestApp());
    const listResponse = await app.inject({ method: 'GET', url: '/api/v1/doctors' });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({ items: [], nextCursor: null });

    const detailResponse = await app.inject({ method: 'GET', url: '/api/v1/doctors/nonexistent' });
    expect(detailResponse.statusCode).toBe(404);
  });

  it('write routes — 401 with no session', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'POST', url: '/api/v1/doctors', payload: {} });
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('UNAUTHENTICATED');
  });

  it('write routes — 403 for an authenticated non-MCS role', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAs(app, 'student@diu.edu.bd');
    const response = await app.inject({ method: 'POST', url: '/api/v1/doctors', headers: { cookie }, payload: { fullName: 'Dr. Nobody' } });
    expect(response.statusCode).toBe(403);
  });

  it('POST /doctors — 201, matches the documented shape', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAs(app, 'mcs@diu.edu.bd');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/doctors',
      headers: { cookie },
      payload: { fullName: 'Dr. Rahman', designation: 'Consultant', specialisation: 'General Medicine' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      doctorId: expect.any(String),
      userAccountId: null,
      fullName: 'Dr. Rahman',
      designation: 'Consultant',
      specialisation: 'General Medicine',
      photoUrl: null,
      isActive: true,
      activeRosterCount: 0,
      upcomingSessionCount: 0,
      version: 1,
    });
  });

  it('POST /doctors — 422 VALIDATION_FAILED for an empty full name', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAs(app, 'mcs@diu.edu.bd');
    const response = await app.inject({ method: 'POST', url: '/api/v1/doctors', headers: { cookie }, payload: { fullName: '' } });
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('VALIDATION_FAILED');
  });

  it('GET /doctors/{id} — 200 once created, then PATCH — 200, and a stale PATCH — 409 CONFLICT_STALE_VERSION', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAs(app, 'mcs@diu.edu.bd');
    const created = await app.inject({ method: 'POST', url: '/api/v1/doctors', headers: { cookie }, payload: { fullName: 'Dr. Islam' } });
    const { doctorId } = created.json<{ doctorId: string }>();

    const getResponse = await app.inject({ method: 'GET', url: `/api/v1/doctors/${doctorId}` });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({ doctorId, fullName: 'Dr. Islam' });

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/doctors/${doctorId}`,
      headers: { cookie },
      payload: { designation: 'Senior Consultant', version: 1 },
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toMatchObject({ designation: 'Senior Consultant', version: 2 });

    const staleResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/doctors/${doctorId}`,
      headers: { cookie },
      payload: { designation: 'Someone else got here first', version: 1 },
    });
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json<ErrorEnvelopeBody>().error.code).toBe('CONFLICT_STALE_VERSION');
  });

  it('POST /doctors/{id}/deactivate — 200, matches the documented shape', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAs(app, 'mcs@diu.edu.bd');
    const created = await app.inject({ method: 'POST', url: '/api/v1/doctors', headers: { cookie }, payload: { fullName: 'Dr. Karim' } });
    const { doctorId } = created.json<{ doctorId: string }>();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/doctors/${doctorId}/deactivate`,
      headers: { cookie },
      payload: { reason: 'Left the medical centre at the end of July', version: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      doctorId,
      isActive: false,
      affectedUpcomingSessions: 0,
      message: 'Upcoming sessions remain scheduled. Cancel them or record unavailability to release the bookings.',
      version: 2,
    });
  });

  it('DELETE /doctors/{id} — 204, then a subsequent GET is 404', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAs(app, 'mcs@diu.edu.bd');
    const created = await app.inject({ method: 'POST', url: '/api/v1/doctors', headers: { cookie }, payload: { fullName: 'Dr. Fatima' } });
    const { doctorId } = created.json<{ doctorId: string }>();

    const deleteResponse = await app.inject({ method: 'DELETE', url: `/api/v1/doctors/${doctorId}`, headers: { cookie } });
    expect(deleteResponse.statusCode).toBe(204);

    const getResponse = await app.inject({ method: 'GET', url: `/api/v1/doctors/${doctorId}` });
    expect(getResponse.statusCode).toBe(404);
  });
});
