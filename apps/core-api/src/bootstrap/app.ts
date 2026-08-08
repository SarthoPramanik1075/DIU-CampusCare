import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { createPolicyEnforcementPoint } from '../kernel/authz/policy-enforcement-point.js';
import { registerCorrelationId } from '../kernel/http/correlation.js';
import { registerErrorHandling } from '../kernel/http/error-handler.js';
import { REDACTED_PATHS, REDACTION_CENSOR } from '../kernel/logging/redaction.js';
import { registerAnnouncementRoutes } from '../modules/config/index.js';
import { registerDashboardRoutes } from '../modules/dashboard/index.js';
import { registerAccountAdminRoutes, registerAuthRoutes, registerOwnProfileRoutes } from '../modules/iam/index.js';
import { registerDoctorRoutes, registerDutyRosterRoutes } from '../modules/scheduling/index.js';

import type { Container } from './container.js';

/**
 * Assembles the Fastify instance from an already-built {@link Container}.
 * Route registration is the only place a module's `interface/http` layer is
 * touched from outside the module — everything else about a module stays
 * behind its `index.ts` (DR-2).
 *
 * Fastify builds its own internal pino instance for request/response access
 * logs rather than reusing `container.logger` directly — passing an
 * already-constructed `pino.Logger` into Fastify's `loggerInstance` option
 * pulls in a stricter internal type (`BaseLogger`, which requires
 * `msgPrefix`) than Fastify's own `FastifyBaseLogger` contract, which is a
 * typing conflict between the two packages' pino versions rather than
 * anything meaningful about the log content. Passing a plain options object
 * sidesteps it, and carries the same redaction rules our own logger uses so
 * Fastify's access logs are held to the same NFR-MNT-03 standard.
 */
export async function buildApp(container: Container): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: container.config.logLevel,
      redact: { paths: [...REDACTED_PATHS], censor: REDACTION_CENSOR },
    },
  });

  await app.register(registerCorrelationId);
  await app.register(cors, { origin: [...container.config.webAppOrigins], credentials: true });
  // `secret` enables signed cookies — the SSO pre-session (§1.1) is one,
  // carrying its PKCE verifier and state across the IdP round trip.
  await app.register(cookie, { secret: container.config.sessionSecret });

  registerErrorHandling(app, container.logger);

  const pep = createPolicyEnforcementPoint({
    pdp: container.pdp,
    auditRecorder: container.auditRecorder,
    resolveSubject: container.resolveSubject,
  });

  registerAnnouncementRoutes(app, {
    pep,
    listActiveAnnouncements: container.listActiveAnnouncements,
  });

  registerAuthRoutes(app, {
    loginWithPassword: container.loginWithPassword,
    logout: container.logout,
    getSession: container.getSession,
    ssoLogin: container.ssoLogin,
    ssoCallback: container.ssoCallback,
    requestPasswordReset: container.requestPasswordReset,
    confirmPasswordReset: container.confirmPasswordReset,
    // API §0.2: Secure in every real deployment; only relaxed for local
    // http:// development, same distinction NODE_ENV already draws
    // elsewhere in this bootstrap.
    cookieSecure: container.config.nodeEnv === 'production',
  });

  registerOwnProfileRoutes(app, {
    pep,
    getSession: container.getSession,
    getOwnProfile: container.getOwnProfile,
    updateOwnProfile: container.updateOwnProfile,
  });

  registerAccountAdminRoutes(app, {
    pep,
    getSession: container.getSession,
    listAccounts: container.listAccounts,
    getAccountDetail: container.getAccountDetail,
    createAccount: container.createAccount,
    updateAccountAdmin: container.updateAccountAdmin,
    suspendAccount: container.suspendAccount,
    activateAccount: container.activateAccount,
    deactivateAccount: container.deactivateAccount,
    listRoleCatalogue: container.listRoleCatalogue,
    grantRole: container.grantRole,
    revokeRole: container.revokeRole,
  });

  registerDashboardRoutes(app, {
    getSession: container.getSession,
    getStudentDashboard: container.getStudentDashboard,
  });

  registerDoctorRoutes(app, {
    pep,
    getSession: container.getSession,
    listDoctors: container.listDoctors,
    getDoctor: container.getDoctor,
    createDoctor: container.createDoctor,
    updateDoctor: container.updateDoctor,
    deactivateDoctor: container.deactivateDoctor,
    deleteDoctor: container.deleteDoctor,
  });

  registerDutyRosterRoutes(app, {
    pep,
    getSession: container.getSession,
    listDutyRosters: container.listDutyRosters,
    createDutyRoster: container.createDutyRoster,
    updateDutyRoster: container.updateDutyRoster,
    deleteDutyRoster: container.deleteDutyRoster,
  });

  return app;
}
