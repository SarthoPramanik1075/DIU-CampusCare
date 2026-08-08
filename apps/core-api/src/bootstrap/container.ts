import type { Kysely } from 'kysely';
import type { Logger } from 'pino';

import { createDatabase, type Database } from '../infrastructure/database/client.js';
import { AuditRecorder } from '../kernel/audit/audit-recorder.js';
import { PolicyDecisionPoint } from '../kernel/authz/policy-decision-point.js';
import { SystemClock, type Clock } from '../kernel/clock/clock.js';
import { EventBus } from '../kernel/events/event-bus.js';
import { CsrfTokenService } from '../kernel/identity/csrf.js';
import { SessionStore } from '../kernel/identity/session-store.js';
import type { SubjectResolver } from '../kernel/identity/subject-resolver.js';
import { createLogger } from '../kernel/logging/logger.js';
import { enqueueNotification } from '../kernel/notifications/enqueue-notification.js';
import { PolicyStore } from '../kernel/policy/policy-store.js';
import { KyselyAnnouncementRepository, ListActiveAnnouncementsHandler } from '../modules/config/index.js';
import { GetStudentDashboardQuery, KyselyDashboardRepository, type DashboardRepository } from '../modules/dashboard/index.js';
import {
  ActivateAccountHandler,
  ConfirmPasswordResetHandler,
  createAuthenticatedSubjectResolver,
  CreateAccountHandler,
  DeactivateAccountHandler,
  GetAccountDetailQuery,
  GetOwnProfileQuery,
  GetSessionQuery,
  GrantRoleHandler,
  KyselyAccountAdminRepository,
  KyselyAuthenticationRepository,
  KyselyOwnProfileRepository,
  KyselyPasswordResetRepository,
  ListAccountsQuery,
  ListRoleCatalogueQuery,
  LoginWithPasswordHandler,
  LogoutHandler,
  OpenIdClientSsoAdapter,
  PasswordHasher,
  PasswordResetTokenGenerator,
  RequestPasswordResetHandler,
  RevokeRoleHandler,
  SessionIssuer,
  SsoCallbackHandler,
  SsoLoginHandler,
  SuspendAccountHandler,
  UpdateAccountAdminHandler,
  UpdateOwnProfileHandler,
  type AccountAdminRepository,
  type AuthenticationRepository,
  type OwnProfileRepository,
  type PasswordResetRepository,
  type SsoClient,
} from '../modules/iam/index.js';
import {
  CreateDoctorHandler,
  CreateDutyRosterHandler,
  DeactivateDoctorHandler,
  DeleteDoctorHandler,
  DeleteDutyRosterHandler,
  GetDoctorQuery,
  KyselyDoctorRepository,
  KyselyDutyRosterRepository,
  ListDoctorsQuery,
  ListDutyRostersQuery,
  UpdateDoctorHandler,
  UpdateDutyRosterHandler,
  type DoctorRepository,
  type DutyRosterRepository,
} from '../modules/scheduling/index.js';

import type { AppConfig } from './config.js';

/**
 * The composition root — DR-5: every infrastructure adapter (the database
 * pool, the logger) is constructed exactly once, here, and handed down by
 * constructor injection. No kernel component and no module ever constructs
 * its own database connection.
 */
export interface Container {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly eventBus: EventBus;
  readonly policyStore: PolicyStore;
  readonly auditRecorder: AuditRecorder;
  readonly pdp: PolicyDecisionPoint;
  readonly passwordHasher: PasswordHasher;
  readonly sessionStore: SessionStore;
  readonly csrfTokenService: CsrfTokenService;
  readonly resolveSubject: SubjectResolver;
  readonly listActiveAnnouncements: ListActiveAnnouncementsHandler;
  readonly loginWithPassword: LoginWithPasswordHandler;
  readonly logout: LogoutHandler;
  readonly getSession: GetSessionQuery;
  readonly ssoLogin: SsoLoginHandler;
  readonly ssoCallback: SsoCallbackHandler;
  readonly requestPasswordReset: RequestPasswordResetHandler;
  readonly confirmPasswordReset: ConfirmPasswordResetHandler;
  readonly getOwnProfile: GetOwnProfileQuery;
  readonly updateOwnProfile: UpdateOwnProfileHandler;
  readonly listAccounts: ListAccountsQuery;
  readonly getAccountDetail: GetAccountDetailQuery;
  readonly createAccount: CreateAccountHandler;
  readonly updateAccountAdmin: UpdateAccountAdminHandler;
  readonly suspendAccount: SuspendAccountHandler;
  readonly activateAccount: ActivateAccountHandler;
  readonly deactivateAccount: DeactivateAccountHandler;
  readonly listRoleCatalogue: ListRoleCatalogueQuery;
  readonly grantRole: GrantRoleHandler;
  readonly revokeRole: RevokeRoleHandler;
  readonly getStudentDashboard: GetStudentDashboardQuery;
  readonly listDoctors: ListDoctorsQuery;
  readonly getDoctor: GetDoctorQuery;
  readonly createDoctor: CreateDoctorHandler;
  readonly updateDoctor: UpdateDoctorHandler;
  readonly deactivateDoctor: DeactivateDoctorHandler;
  readonly deleteDoctor: DeleteDoctorHandler;
  readonly listDutyRosters: ListDutyRostersQuery;
  readonly createDutyRoster: CreateDutyRosterHandler;
  readonly updateDutyRoster: UpdateDutyRosterHandler;
  readonly deleteDutyRoster: DeleteDutyRosterHandler;
}

export function buildContainer(config: AppConfig): Container {
  const logger = createLogger({ name: 'core-api', level: config.logLevel });
  const db = createDatabase(config.databaseUrl);
  const clock = new SystemClock();
  const eventBus = new EventBus();
  const policyStore = new PolicyStore(db);
  const auditRecorder = new AuditRecorder(db);
  const pdp = new PolicyDecisionPoint();
  const passwordHasher = new PasswordHasher();
  const sessionStore = new SessionStore(db, clock);
  const csrfTokenService = new CsrfTokenService(config.sessionSecret);

  const announcementRepository = new KyselyAnnouncementRepository(db);
  const listActiveAnnouncements = new ListActiveAnnouncementsHandler(announcementRepository, clock);

  const authenticationRepository: AuthenticationRepository = new KyselyAuthenticationRepository(db);
  const sessionIssuer = new SessionIssuer(authenticationRepository, sessionStore, csrfTokenService, policyStore);
  const getSession = new GetSessionQuery(authenticationRepository, sessionStore, csrfTokenService, policyStore);
  const loginWithPassword = new LoginWithPasswordHandler(
    authenticationRepository,
    passwordHasher,
    sessionIssuer,
    policyStore,
    auditRecorder,
    (input) => enqueueNotification(db, input),
    clock,
  );
  const logout = new LogoutHandler(sessionStore, auditRecorder);
  const resolveSubject = createAuthenticatedSubjectResolver(getSession);

  const ssoClient: SsoClient = new OpenIdClientSsoAdapter(config.sso);
  const ssoLogin = new SsoLoginHandler(ssoClient);
  const ssoCallback = new SsoCallbackHandler(ssoClient, authenticationRepository, sessionIssuer, auditRecorder);

  const passwordResetRepository: PasswordResetRepository = new KyselyPasswordResetRepository(db);
  const passwordResetTokenGenerator = new PasswordResetTokenGenerator();
  const requestPasswordReset = new RequestPasswordResetHandler(
    authenticationRepository,
    passwordResetRepository,
    passwordResetTokenGenerator,
    policyStore,
    auditRecorder,
    (input) => enqueueNotification(db, input),
    config.webAppOrigin,
    clock,
  );
  const confirmPasswordReset = new ConfirmPasswordResetHandler(
    passwordResetRepository,
    passwordResetTokenGenerator,
    passwordHasher,
    sessionStore,
    auditRecorder,
    clock,
  );

  const ownProfileRepository: OwnProfileRepository = new KyselyOwnProfileRepository(db);
  const getOwnProfile = new GetOwnProfileQuery(ownProfileRepository, authenticationRepository);
  const updateOwnProfile = new UpdateOwnProfileHandler(
    ownProfileRepository,
    authenticationRepository,
    auditRecorder,
    clock,
  );

  const accountAdminRepository: AccountAdminRepository = new KyselyAccountAdminRepository(db);
  const listAccounts = new ListAccountsQuery(accountAdminRepository);
  const getAccountDetail = new GetAccountDetailQuery(accountAdminRepository, auditRecorder);
  const createAccount = new CreateAccountHandler(
    accountAdminRepository,
    passwordHasher,
    passwordResetRepository,
    passwordResetTokenGenerator,
    policyStore,
    auditRecorder,
    (input) => enqueueNotification(db, input),
    config.webAppOrigin,
    clock,
  );
  const updateAccountAdmin = new UpdateAccountAdminHandler(accountAdminRepository, auditRecorder, clock);
  const suspendAccount = new SuspendAccountHandler(accountAdminRepository, sessionStore, auditRecorder, clock);
  const activateAccount = new ActivateAccountHandler(accountAdminRepository, auditRecorder, clock);
  const deactivateAccount = new DeactivateAccountHandler(accountAdminRepository, sessionStore, auditRecorder, clock);
  const listRoleCatalogue = new ListRoleCatalogueQuery(accountAdminRepository);
  const grantRole = new GrantRoleHandler(accountAdminRepository, auditRecorder);
  const revokeRole = new RevokeRoleHandler(accountAdminRepository, auditRecorder, clock);

  const dashboardRepository: DashboardRepository = new KyselyDashboardRepository(db);
  const getStudentDashboard = new GetStudentDashboardQuery(ownProfileRepository, dashboardRepository, listActiveAnnouncements, clock);

  const doctorRepository: DoctorRepository = new KyselyDoctorRepository(db);
  const listDoctors = new ListDoctorsQuery(doctorRepository);
  const getDoctor = new GetDoctorQuery(doctorRepository);
  const createDoctor = new CreateDoctorHandler(doctorRepository, auditRecorder);
  const updateDoctor = new UpdateDoctorHandler(doctorRepository, auditRecorder);
  const deactivateDoctor = new DeactivateDoctorHandler(doctorRepository, auditRecorder);
  const deleteDoctor = new DeleteDoctorHandler(doctorRepository, auditRecorder);

  const dutyRosterRepository: DutyRosterRepository = new KyselyDutyRosterRepository(db);
  const listDutyRosters = new ListDutyRostersQuery(dutyRosterRepository);
  const createDutyRoster = new CreateDutyRosterHandler(dutyRosterRepository, auditRecorder);
  const updateDutyRoster = new UpdateDutyRosterHandler(dutyRosterRepository, auditRecorder);
  const deleteDutyRoster = new DeleteDutyRosterHandler(dutyRosterRepository, auditRecorder);

  return {
    config,
    logger,
    db,
    clock,
    eventBus,
    policyStore,
    auditRecorder,
    pdp,
    passwordHasher,
    sessionStore,
    csrfTokenService,
    resolveSubject,
    listActiveAnnouncements,
    loginWithPassword,
    logout,
    getSession,
    ssoLogin,
    ssoCallback,
    requestPasswordReset,
    confirmPasswordReset,
    getOwnProfile,
    updateOwnProfile,
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
    getStudentDashboard,
    listDoctors,
    getDoctor,
    createDoctor,
    updateDoctor,
    deactivateDoctor,
    deleteDoctor,
    listDutyRosters,
    createDutyRoster,
    updateDutyRoster,
    deleteDutyRoster,
  };
}

export async function closeContainer(container: Container): Promise<void> {
  await container.db.destroy();
}
