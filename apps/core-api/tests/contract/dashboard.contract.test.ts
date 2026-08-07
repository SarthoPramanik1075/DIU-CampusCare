import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/bootstrap/app.js';
import type { Container } from '../../src/bootstrap/container.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { PolicyDecisionPoint } from '../../src/kernel/authz/policy-decision-point.js';
import { CsrfTokenService } from '../../src/kernel/identity/csrf.js';
import { resolveAnonymousSubject } from '../../src/kernel/identity/subject-resolver.js';
import type { Announcement, AnnouncementRepository } from '../../src/modules/config/index.js';
import { ListActiveAnnouncementsHandler } from '../../src/modules/config/index.js';
import type { BookingSuspensionState, DashboardRepository, MedicineStoreState } from '../../src/modules/dashboard/index.js';
import { GetStudentDashboardQuery } from '../../src/modules/dashboard/index.js';
import {
  GetSessionQuery,
  LoginWithPasswordHandler,
  LogoutHandler,
  PasswordHasher,
  SessionIssuer,
  type AccountSummary,
  type AccountWithCredential,
  type AuthenticationRepository,
  type OwnProfileAccount,
  type OwnProfileRepository,
  type StudentProfile,
} from '../../src/modules/iam/index.js';
import { FixedClock } from '../support/fixed-clock.js';

interface ErrorEnvelopeBody {
  readonly error: { readonly code: string; readonly message: string; readonly correlationId: string };
}

interface DashboardBody {
  readonly student: { readonly fullName: string; readonly studentRef: string };
  readonly upcomingAppointments: readonly unknown[];
  readonly todaysDoctors: readonly unknown[];
  readonly medicineStore: MedicineStoreState;
  readonly notifications: { readonly unreadCount: number };
  readonly announcements: readonly { readonly id: string; readonly body: string; readonly endsAt: string }[];
  readonly bookingSuspension: { readonly suspendedUntil: string; readonly reason: string; readonly walkInRemainsAvailable: boolean } | null;
}

const NOW = new Date('2026-08-03T14:00:00+06:00');
const PASSWORD = 'Correct horse battery 1!';
const STUDENT_ID = '0191f5aa-0000-7000-8000-000000000501';
const STAFF_ID = '0191f5aa-0000-7000-8000-000000000502';

class InMemoryAuthenticationRepository implements AuthenticationRepository {
  constructor(private readonly accounts: readonly AccountWithCredential[]) {}

  findAccountWithCredentialByEmail(email: string): Promise<AccountWithCredential | null> {
    return Promise.resolve(this.accounts.find((a) => a.email.toLowerCase() === email.toLowerCase()) ?? null);
  }

  findAccountById(userAccountId: string): Promise<AccountSummary | null> {
    const account = this.accounts.find((a) => a.id === userAccountId);
    if (account === undefined) return Promise.resolve(null);
    const { id, email, fullName, status, version } = account;
    return Promise.resolve({ id, email, fullName, status, version });
  }

  loadActiveRoleCodes(userAccountId: string) {
    return Promise.resolve(userAccountId === STUDENT_ID ? (['STU'] as const) : (['MCS'] as const));
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

class FakeOwnProfileRepository implements Pick<OwnProfileRepository, 'findAccountById' | 'findStudentProfile'> {
  findAccountById(userAccountId: string): Promise<OwnProfileAccount | null> {
    if (userAccountId === STUDENT_ID) {
      return Promise.resolve({ id: STUDENT_ID, email: 'student@diu.edu.bd', fullName: 'Nusrat Jahan', status: 'active', version: 1, authMethod: 'sso' });
    }
    if (userAccountId === STAFF_ID) {
      return Promise.resolve({ id: STAFF_ID, email: 'staff@diu.edu.bd', fullName: 'Reception Staff', status: 'active', version: 1, authMethod: 'local' });
    }
    return Promise.resolve(null);
  }

  findStudentProfile(userAccountId: string): Promise<StudentProfile | null> {
    if (userAccountId !== STUDENT_ID) return Promise.resolve(null);
    return Promise.resolve({ studentRef: '221-15-5678', programme: 'BSc in CSE', isEnrolled: true });
  }
}

class FakeDashboardRepository implements DashboardRepository {
  bookingSuspension: BookingSuspensionState | null = null;
  unreadCount = 2;

  findMedicineStoreState(): Promise<MedicineStoreState> {
    return Promise.resolve({ isOpen: true, opensAt: '09:00:00', closesAt: '17:00:00', stateSource: 'scheduled_hours' });
  }

  findActiveBookingSuspension(): Promise<BookingSuspensionState | null> {
    return Promise.resolve(this.bookingSuspension);
  }

  countUnreadNotifications(): Promise<number> {
    return Promise.resolve(this.unreadCount);
  }
}

class FakeAnnouncementRepository implements AnnouncementRepository {
  findAll(): Promise<readonly Announcement[]> {
    return Promise.resolve([
      { id: 'ann-1', body: 'The medical centre will close early on Friday.', startsAt: new Date('2026-08-01T00:00:00+06:00'), endsAt: new Date('2026-08-12T23:59:00+06:00') },
    ]);
  }
}

async function buildTestApp(): Promise<{ app: FastifyInstance; dashboardRepository: FakeDashboardRepository }> {
  const passwordHasher = new PasswordHasher();
  const accounts: AccountWithCredential[] = [
    {
      id: STUDENT_ID,
      email: 'student@diu.edu.bd',
      fullName: 'Nusrat Jahan',
      status: 'active',
      version: 1,
      passwordHash: await passwordHasher.hash(PASSWORD),
      failedAttempts: 0,
      lockedUntil: null,
    },
    {
      id: STAFF_ID,
      email: 'staff@diu.edu.bd',
      fullName: 'Reception Staff',
      status: 'active',
      version: 1,
      passwordHash: await passwordHasher.hash(PASSWORD),
      failedAttempts: 0,
      lockedUntil: null,
    },
  ];
  const repository = new InMemoryAuthenticationRepository(accounts);
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

  const auditRecorder = { recordChange: () => Promise.resolve(), recordDenial: () => Promise.resolve() } as unknown as AuditRecorder;

  const sessionIssuer = new SessionIssuer(repository, sessionStore, csrfTokenService, policyStore);
  const loginWithPassword = new LoginWithPasswordHandler(repository, passwordHasher, sessionIssuer, policyStore, auditRecorder, () => Promise.resolve(), clock);
  const getSession = new GetSessionQuery(repository, sessionStore, csrfTokenService, policyStore);
  const logout = new LogoutHandler(sessionStore, auditRecorder);

  const ownProfileRepository = new FakeOwnProfileRepository();
  const dashboardRepository = new FakeDashboardRepository();
  const listActiveAnnouncements = new ListActiveAnnouncementsHandler(new FakeAnnouncementRepository(), clock);
  const getStudentDashboard = new GetStudentDashboardQuery(ownProfileRepository, dashboardRepository, listActiveAnnouncements, clock);

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
    ssoLogin: undefined as unknown as Container['ssoLogin'],
    ssoCallback: undefined as unknown as Container['ssoCallback'],
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
    getStudentDashboard,
  };

  return { app: await buildApp(container), dashboardRepository };
}

async function loginAs(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
  return response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

describe('GET /api/v1/me/dashboard — contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('401 with no session', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/dashboard' });
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('UNAUTHENTICATED');
  });

  it('403 FORBIDDEN for a non-student session — FR-DASH-01', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAs(app, 'staff@diu.edu.bd');
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/dashboard', headers: { cookie } });
    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('FORBIDDEN');
  });

  it('200 with the full documented shape for a student session', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAs(app, 'student@diu.edu.bd');

    const response = await app.inject({ method: 'GET', url: '/api/v1/me/dashboard', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json<DashboardBody>();
    expect(Object.keys(body).sort()).toEqual(
      ['announcements', 'bookingSuspension', 'medicineStore', 'notifications', 'student', 'todaysDoctors', 'upcomingAppointments'].sort(),
    );
    expect(body.student).toEqual({ fullName: 'Nusrat Jahan', studentRef: '221-15-5678' });
    expect(body.upcomingAppointments).toEqual([]);
    expect(body.todaysDoctors).toEqual([]);
    expect(body.medicineStore).toEqual({ isOpen: true, opensAt: '09:00:00', closesAt: '17:00:00', stateSource: 'scheduled_hours' });
    expect(body.notifications).toEqual({ unreadCount: 2 });
    expect(body.announcements).toEqual([{ id: 'ann-1', body: 'The medical centre will close early on Friday.', endsAt: '2026-08-12T23:59:00+06:00' }]);
    expect(body.bookingSuspension).toBeNull();
  });

  it('bookingSuspension, when active, is a real BST-formatted object', async () => {
    const built = await buildTestApp();
    app = built.app;
    built.dashboardRepository.bookingSuspension = { suspendedUntil: new Date('2026-08-10T00:00:00+06:00'), reason: 'Missed 3 appointments without notice.', walkInRemainsAvailable: true };
    const cookie = await loginAs(app, 'student@diu.edu.bd');

    const response = await app.inject({ method: 'GET', url: '/api/v1/me/dashboard', headers: { cookie } });
    const body = response.json<DashboardBody>();

    expect(body.bookingSuspension).toEqual({
      suspendedUntil: '2026-08-10T00:00:00+06:00',
      reason: 'Missed 3 appointments without notice.',
      walkInRemainsAvailable: true,
    });
  });
});
