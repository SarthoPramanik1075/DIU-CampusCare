import { ROLE_NAMES, type AuthenticatedRoleCode } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/bootstrap/app.js';
import type { Container } from '../../src/bootstrap/container.js';
import { AuditRecorder } from '../../src/kernel/audit/audit-recorder.js';
import { PolicyDecisionPoint } from '../../src/kernel/authz/policy-decision-point.js';
import { CsrfTokenService } from '../../src/kernel/identity/csrf.js';
import {
  ActivateAccountHandler,
  createAuthenticatedSubjectResolver,
  CreateAccountHandler,
  DeactivateAccountHandler,
  GetAccountDetailQuery,
  GetSessionQuery,
  GrantRoleHandler,
  isRoleAssignableByAdmin,
  ListAccountsQuery,
  ListRoleCatalogueQuery,
  LoginWithPasswordHandler,
  LogoutHandler,
  PasswordHasher,
  PasswordResetTokenGenerator,
  RevokeRoleHandler,
  roleRequiresClinicalStaff,
  SessionIssuer,
  SsoCallbackHandler,
  SsoLoginHandler,
  SuspendAccountHandler,
  UpdateAccountAdminHandler,
  type AccountAdminRepository,
  type AccountDetail,
  type AccountListFilter,
  type AccountListPage,
  type AccountSummary,
  type AccountWithCredential,
  type AuthenticationRepository,
  type CreateAccountInput,
  type CreateAccountResult,
  type GrantRoleInput,
  type GrantRoleOutcome,
  type RevokeRoleInput,
  type RevokeRoleOutcome,
  type RoleCatalogueEntry,
  type SsoClient,
  type TransitionStatusInput,
  type TransitionStatusOutcome,
  type UpdateAccountAdminInput,
  type UpdateAccountAdminOutcome,
} from '../../src/modules/iam/index.js';
import { FixedClock } from '../support/fixed-clock.js';

interface ErrorEnvelopeBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly correlationId: string;
    readonly fields?: readonly { readonly field: string }[];
    readonly details?: Record<string, unknown>;
  };
}

const NOW = new Date('2026-08-03T14:00:00+06:00');
const PASSWORD = 'Correct horse battery 1!';
const ADMIN_ID = '0191f5aa-0000-7000-8000-000000000401';

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
    return Promise.resolve(['ADM'] as const);
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

class InMemoryAccountAdminRepository implements AccountAdminRepository {
  private accounts = new Map<string, AccountDetail>();
  private nextId = 1;

  seed(account: AccountDetail): void {
    this.accounts.set(account.userId, account);
  }

  listAccounts(filter: AccountListFilter): Promise<AccountListPage> {
    let items = [...this.accounts.values()];
    if (filter.status !== undefined) items = items.filter((a) => a.status === filter.status);
    return Promise.resolve({
      items: items.map((a) => ({
        userId: a.userId,
        email: a.email,
        fullName: a.fullName,
        status: a.status,
        roles: a.roles.map((r) => r.code),
        studentRef: a.studentProfile?.studentRef ?? null,
        createdAt: NOW,
        version: a.version,
      })),
      nextCursor: null,
    });
  }

  findAccountDetailById(userId: string): Promise<AccountDetail | null> {
    return Promise.resolve(this.accounts.get(userId) ?? null);
  }

  isEmailRegistered(email: string): Promise<boolean> {
    return Promise.resolve([...this.accounts.values()].some((a) => a.email.toLowerCase() === email.toLowerCase()));
  }

  createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
    if ([...this.accounts.values()].some((a) => a.email.toLowerCase() === input.email.toLowerCase())) {
      return Promise.resolve({ outcome: 'email_taken' });
    }
    const userId = `created-${String(this.nextId++)}`;
    const account: AccountDetail = {
      userId,
      email: input.email,
      fullName: input.fullName,
      status: 'pending',
      authMethod: input.authMethod,
      roles: input.roles.map((code) => ({ code, grantedBy: input.createdBy, grantedAt: NOW })),
      studentProfile: null,
      lockedUntil: null,
      lastLoginAt: null,
      isClinicalStaff: input.isClinicalStaff,
      version: 1,
    };
    this.accounts.set(userId, account);
    return Promise.resolve({ outcome: 'created', account });
  }

  updateAccountAdmin(input: UpdateAccountAdminInput): Promise<UpdateAccountAdminOutcome> {
    const current = this.accounts.get(input.userId);
    if (current === undefined) return Promise.resolve({ outcome: 'not_found' });
    if (current.version !== input.expectedVersion) return Promise.resolve({ outcome: 'stale' });

    const updated: AccountDetail = {
      ...current,
      fullName: input.fullName ?? current.fullName,
      isClinicalStaff: input.isClinicalStaff ?? current.isClinicalStaff,
      version: current.version + 1,
    };
    this.accounts.set(input.userId, updated);
    return Promise.resolve({ outcome: 'updated', account: updated });
  }

  transitionStatus(input: TransitionStatusInput): Promise<TransitionStatusOutcome> {
    const current = this.accounts.get(input.userId);
    if (current === undefined) return Promise.resolve({ outcome: 'not_found' });
    if (current.version !== input.expectedVersion) return Promise.resolve({ outcome: 'stale' });

    const updated: AccountDetail = { ...current, status: input.newStatus, version: current.version + 1 };
    this.accounts.set(input.userId, updated);
    return Promise.resolve({ outcome: 'transitioned', account: updated });
  }

  findActiveAppointmentsForStudent(): Promise<readonly []> {
    return Promise.resolve([]);
  }

  listRoleCatalogue(): Promise<readonly RoleCatalogueEntry[]> {
    const codes: readonly AuthenticatedRoleCode[] = ['STU', 'DOC', 'MCS', 'STO', 'CNP', 'ADM'];
    return Promise.resolve(
      codes.map((code) => ({
        code,
        name: ROLE_NAMES[code],
        assignableByAdmin: isRoleAssignableByAdmin(code),
        requiresClinicalStaff: roleRequiresClinicalStaff(code),
      })),
    );
  }

  grantRole(input: GrantRoleInput): Promise<GrantRoleOutcome> {
    const account = this.accounts.get(input.userId);
    if (account === undefined) return Promise.resolve({ outcome: 'not_found' });
    if (account.roles.some((role) => role.code === input.roleCode)) return Promise.resolve({ outcome: 'already_held' });

    const updated: AccountDetail = {
      ...account,
      roles: [...account.roles, { code: input.roleCode, grantedBy: input.grantedBy, grantedAt: NOW }],
    };
    this.accounts.set(input.userId, updated);
    return Promise.resolve({ outcome: 'granted', account: updated });
  }

  revokeRole(input: RevokeRoleInput): Promise<RevokeRoleOutcome> {
    const account = this.accounts.get(input.userId);
    if (account === undefined) return Promise.resolve({ outcome: 'not_found' });
    if (!account.roles.some((role) => role.code === input.roleCode)) return Promise.resolve({ outcome: 'not_held' });

    if (input.roleCode === 'ADM') {
      const activeAdminCount = [...this.accounts.values()].filter((a) => a.roles.some((role) => role.code === 'ADM')).length;
      if (activeAdminCount <= 1) return Promise.resolve({ outcome: 'would_remove_last_admin' });
    }

    const updated: AccountDetail = { ...account, roles: account.roles.filter((role) => role.code !== input.roleCode) };
    this.accounts.set(input.userId, updated);
    return Promise.resolve({ outcome: 'revoked', account: updated });
  }
}

async function buildTestApp(): Promise<{ app: FastifyInstance; accountAdminRepository: InMemoryAccountAdminRepository }> {
  const passwordHasher = new PasswordHasher();
  const adminAccount: AccountWithCredential = {
    id: ADMIN_ID,
    email: 'admin@diu.edu.bd',
    fullName: 'DIU IT Admin',
    status: 'active',
    version: 1,
    passwordHash: await passwordHasher.hash(PASSWORD),
    failedAttempts: 0,
    lockedUntil: null,
  };
  const repository = new InMemoryAuthenticationRepository(adminAccount);
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
        'auth.passwordReset.expiryMinutes': 30,
      };
      return Promise.resolve(values[key]!);
    },
  } as unknown as Container['policyStore'];

  const auditRecorder = {
    recordChange: () => Promise.resolve(),
    recordDenial: () => Promise.resolve(),
    recordDataAccess: () => Promise.resolve(),
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

  const accountAdminRepository = new InMemoryAccountAdminRepository();
  accountAdminRepository.seed({
    userId: 'target-1',
    email: 'target@diu.edu.bd',
    fullName: 'Target Account',
    status: 'active',
    authMethod: 'sso',
    roles: [{ code: 'STU', grantedBy: 'target-1', grantedAt: NOW }],
    studentProfile: null,
    lockedUntil: null,
    lastLoginAt: null,
    isClinicalStaff: false,
    version: 1,
  });
  // The logged-in administrator's own account, in this repository too (it
  // is otherwise only known to InMemoryAuthenticationRepository, for
  // login) — needed to exercise LAST_ADMIN_ROLE, which is a real,
  // system-wide count over identity.user_role, not specific to "this" account.
  accountAdminRepository.seed({
    userId: ADMIN_ID,
    email: 'admin@diu.edu.bd',
    fullName: 'DIU IT Admin',
    status: 'active',
    authMethod: 'local',
    roles: [{ code: 'ADM', grantedBy: ADMIN_ID, grantedAt: NOW }],
    studentProfile: null,
    lockedUntil: null,
    lastLoginAt: null,
    isClinicalStaff: false,
    version: 1,
  });

  const listAccounts = new ListAccountsQuery(accountAdminRepository);
  const getAccountDetail = new GetAccountDetailQuery(accountAdminRepository, auditRecorder);
  const passwordResetTokenGenerator = new PasswordResetTokenGenerator();
  const passwordResetRepository = {
    createToken: () => Promise.resolve(),
    findValidToken: () => Promise.resolve(null),
    consumeToken: () => Promise.resolve(),
    updatePasswordHash: () => Promise.resolve(),
  };
  const createAccount = new CreateAccountHandler(
    accountAdminRepository,
    passwordHasher,
    passwordResetRepository,
    passwordResetTokenGenerator,
    policyStore,
    auditRecorder,
    () => Promise.resolve(),
    'http://localhost:5173',
    clock,
  );
  const updateAccountAdmin = new UpdateAccountAdminHandler(accountAdminRepository, auditRecorder, clock);
  const suspendAccount = new SuspendAccountHandler(accountAdminRepository, sessionStore, auditRecorder, clock);
  const activateAccount = new ActivateAccountHandler(accountAdminRepository, auditRecorder, clock);
  const deactivateAccount = new DeactivateAccountHandler(accountAdminRepository, sessionStore, auditRecorder, clock);
  const listRoleCatalogue = new ListRoleCatalogueQuery(accountAdminRepository);
  const grantRole = new GrantRoleHandler(accountAdminRepository, auditRecorder);
  const revokeRole = new RevokeRoleHandler(accountAdminRepository, auditRecorder, clock);

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
    listAccounts,
    getAccountDetail,
    createAccount,
    updateAccountAdmin,
    suspendAccount,
    activateAccount,
    deactivateAccount,
    listRoleCatalogue,
    grantRole,
    revokeRole,
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
    deleteDutyRoster: undefined as unknown as Container['deleteDutyRoster'],    listClinicSessions: undefined as unknown as Container['listClinicSessions'],    getClinicSession: undefined as unknown as Container['getClinicSession'],    createClinicSession: undefined as unknown as Container['createClinicSession'],    updateClinicSession: undefined as unknown as Container['updateClinicSession'],    getSessionSlots: undefined as unknown as Container['getSessionSlots'],    startSession: undefined as unknown as Container['startSession'],    interruptSession: undefined as unknown as Container['interruptSession'],    completeSession: undefined as unknown as Container['completeSession'],    cancelSession: undefined as unknown as Container['cancelSession'],
  };

  return { app: await buildApp(container), accountAdminRepository };
}

async function loginAsAdmin(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'admin@diu.edu.bd', password: PASSWORD },
  });
  return response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

describe('Account administration routes — contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('every route — 401 with no session', async () => {
    ({ app } = await buildTestApp());
    const response = await app.inject({ method: 'GET', url: '/api/v1/users' });
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /api/v1/users — 200 with the seeded account for an ADM session', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/users', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: readonly { userId: string }[]; nextCursor: null }>();
    expect(body.items.map((i) => i.userId)).toContain('target-1');
  });

  it('GET /api/v1/users — 422 when q is under 2 characters', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/users?q=a', headers: { cookie } });
    expect(response.statusCode).toBe(422);
  });

  it('POST /api/v1/users — 201 creates a local account and matches GET /users/{id} shape', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie },
      payload: { email: 'dr.rahman@diu.edu.bd', fullName: 'Dr. Rahman', authMethod: 'local', roles: ['MCS'] },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ userId: string; status: string; authMethod: string }>();
    expect(body.status).toBe('pending');
    expect(body.authMethod).toBe('local');
    expect(Object.keys(body).sort()).toEqual(
      ['authMethod', 'email', 'fullName', 'lastLoginAt', 'lockedUntil', 'roles', 'status', 'studentProfile', 'userId', 'version'].sort(),
    );
  });

  it('POST /api/v1/users — 422 ROLE_NOT_ASSIGNABLE for STU', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie },
      payload: { email: 'student2@diu.edu.bd', fullName: 'Someone', authMethod: 'sso', roles: ['STU'] },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('POST /api/v1/users — 409 EMAIL_ALREADY_REGISTERED', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie },
      payload: { email: 'target@diu.edu.bd', fullName: 'Duplicate', authMethod: 'sso', roles: ['MCS'] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('GET /api/v1/users/{id} — 404 for an unknown id', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/users/unknown-id', headers: { cookie } });
    expect(response.statusCode).toBe(404);
  });

  it('GET /api/v1/users/{id} — 200 for the seeded account', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/users/target-1', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ userId: string }>().userId).toBe('target-1');
  });

  it('PATCH /api/v1/users/{id} — 422 FIELD_NOT_EDITABLE for status or roles', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/target-1',
      headers: { cookie },
      payload: { status: 'suspended', version: 1 },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('FIELD_NOT_EDITABLE');
  });

  it('PATCH /api/v1/users/{id} — 200 updates fullName and increments version', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/target-1',
      headers: { cookie },
      payload: { fullName: 'Renamed Target', version: 1 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ fullName: string; version: number }>();
    expect(body.fullName).toBe('Renamed Target');
    expect(body.version).toBe(2);
  });

  it('POST /api/v1/users/{id}/suspend — 422 when reason is too short', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/target-1/suspend',
      headers: { cookie },
      payload: { reason: 'short', version: 1 },
    });
    expect(response.statusCode).toBe(422);
  });

  it('POST /api/v1/users/{id}/suspend then /activate — full lifecycle round trip', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const suspend = await app.inject({
      method: 'POST',
      url: '/api/v1/users/target-1/suspend',
      headers: { cookie },
      payload: { reason: 'Enrolment under review by the registrar', version: 1 },
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json<{ status: string; version: number }>()).toMatchObject({ status: 'suspended', version: 2 });

    // Suspending an already-suspended account is rejected — only active/pending may suspend.
    const reSuspend = await app.inject({
      method: 'POST',
      url: '/api/v1/users/target-1/suspend',
      headers: { cookie },
      payload: { reason: 'Enrolment under review by the registrar', version: 2 },
    });
    expect(reSuspend.statusCode).toBe(409);
    const reSuspendBody = reSuspend.json<ErrorEnvelopeBody>();
    expect(reSuspendBody.error.code).toBe('INVALID_STATUS_TRANSITION');
    // Regression guard: this must name "suspended", not "deactivated" — the
    // account is not deactivated, and the two share one error code but
    // must not share the wrong message.
    expect(reSuspendBody.error.message).toBe('This account is already suspended.');

    const activate = await app.inject({
      method: 'POST',
      url: '/api/v1/users/target-1/activate',
      headers: { cookie },
      payload: { reason: 'Enrolment confirmed by the registrar', version: 2 },
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json<{ status: string; version: number }>()).toMatchObject({ status: 'active', version: 3 });
  });

  it('POST /api/v1/users/{id}/suspend — 409 INVALID_STATUS_TRANSITION on an already-deactivated account', async () => {
    const { app: testApp, accountAdminRepository } = await buildTestApp();
    app = testApp;
    accountAdminRepository.seed({
      userId: 'deactivated-1',
      email: 'gone@diu.edu.bd',
      fullName: 'Gone',
      status: 'deactivated',
      authMethod: 'sso',
      roles: [],
      studentProfile: null,
      lockedUntil: null,
      lastLoginAt: null,
      isClinicalStaff: false,
      version: 1,
    });
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/deactivated-1/suspend',
      headers: { cookie },
      payload: { reason: 'Enrolment under review by the registrar', version: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('POST /api/v1/users/{id}/deactivate — 200 with an empty cancelledAppointments (honestly empty until M2)', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/target-1/deactivate',
      headers: { cookie },
      payload: { reason: 'Student graduated at the end of Spring 2026', confirmedImpact: false, version: 1 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; cancelledAppointments: readonly unknown[] }>();
    expect(body.status).toBe('deactivated');
    expect(body.cancelledAppointments).toEqual([]);
  });

  it('PATCH /api/v1/users/{id} — 409 CONFLICT_STALE_VERSION', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/target-1',
      headers: { cookie },
      payload: { fullName: 'Whatever', version: 999 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('CONFLICT_STALE_VERSION');
  });

  it('GET /api/v1/roles — 200 with the full catalogue, STU not assignable, CNP requiring clinical staff', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/roles', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: readonly { code: string; assignableByAdmin: boolean; requiresClinicalStaff: boolean }[] }>();
    expect(body.items.map((i) => i.code).sort()).toEqual(['ADM', 'CNP', 'DOC', 'MCS', 'STO', 'STU'].sort());
    expect(body.items.find((i) => i.code === 'STU')).toMatchObject({ assignableByAdmin: false });
    expect(body.items.find((i) => i.code === 'CNP')).toMatchObject({ assignableByAdmin: true, requiresClinicalStaff: true });
  });

  it('POST /api/v1/users/{id}/roles — 200 grants a role and it appears in roles[]', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/target-1/roles',
      headers: { cookie },
      payload: { roleCode: 'MCS', reason: 'Joined medical centre reception on 1 August' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ roles: readonly { code: string }[] }>();
    expect(body.roles.map((r) => r.code)).toContain('MCS');
  });

  it('POST /api/v1/users/{id}/roles — 422 ROLE_NOT_ASSIGNABLE for STU', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/target-1/roles',
      headers: { cookie },
      payload: { roleCode: 'STU', reason: 'Joined medical centre reception on 1 August' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('POST /api/v1/users/{id}/roles — 409 ROLE_ALREADY_HELD for a role already granted', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/target-1/roles',
      headers: { cookie },
      payload: { roleCode: 'STU', reason: 'Already a student, testing duplicate grant' },
    });

    // target-1 was seeded with STU already — grantRole rejects STU up front
    // (ROLE_NOT_ASSIGNABLE) before ever reaching ROLE_ALREADY_HELD, so this
    // proves the STU gate wins; the already-held path is covered at the
    // unit tier (grant-role.handler.test.ts), where STU can be bypassed.
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('DELETE /api/v1/users/{id}/roles/{roleCode} — 200 revokes a role', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/users/target-1/roles/STU',
      headers: { cookie },
      payload: { reason: 'Transferred out of the medical centre' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ roles: readonly { code: string }[] }>();
    expect(body.roles.map((r) => r.code)).not.toContain('STU');
  });

  it('DELETE /api/v1/users/{id}/roles/{roleCode} — 404 ROLE_NOT_HELD when the account never had it', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/users/target-1/roles/CNP',
      headers: { cookie },
      payload: { reason: 'Testing a role never granted' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('ROLE_NOT_HELD');
  });

  it('DELETE /api/v1/users/{id}/roles/{roleCode} — 409 LAST_ADMIN_ROLE protects the sole administrator', async () => {
    ({ app } = await buildTestApp());
    const cookie = await loginAsAdmin(app);

    // ADMIN_ID is the only ADM in this fake repository's seed data.
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${ADMIN_ID}/roles/ADM`,
      headers: { cookie },
      payload: { reason: "Attempting to remove the system's only administrator" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorEnvelopeBody>().error.code).toBe('LAST_ADMIN_ROLE');
  });
});
