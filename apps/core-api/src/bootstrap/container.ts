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
import {
  ConfirmPasswordResetHandler,
  createAuthenticatedSubjectResolver,
  GetOwnProfileQuery,
  GetSessionQuery,
  KyselyAuthenticationRepository,
  KyselyOwnProfileRepository,
  KyselyPasswordResetRepository,
  LoginWithPasswordHandler,
  LogoutHandler,
  OpenIdClientSsoAdapter,
  PasswordHasher,
  PasswordResetTokenGenerator,
  RequestPasswordResetHandler,
  SessionIssuer,
  SsoCallbackHandler,
  SsoLoginHandler,
  UpdateOwnProfileHandler,
  type AuthenticationRepository,
  type OwnProfileRepository,
  type PasswordResetRepository,
  type SsoClient,
} from '../modules/iam/index.js';

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
  };
}

export async function closeContainer(container: Container): Promise<void> {
  await container.db.destroy();
}
