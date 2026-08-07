import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { createPolicyEnforcementPoint } from '../kernel/authz/policy-enforcement-point.js';
import { registerCorrelationId } from '../kernel/http/correlation.js';
import { registerErrorHandling } from '../kernel/http/error-handler.js';
import { REDACTED_PATHS, REDACTION_CENSOR } from '../kernel/logging/redaction.js';
import { registerAnnouncementRoutes } from '../modules/config/index.js';
import { registerAuthRoutes } from '../modules/iam/index.js';

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
  await app.register(cors, { origin: container.config.webAppOrigin, credentials: true });
  await app.register(cookie);

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
    // API §0.2: Secure in every real deployment; only relaxed for local
    // http:// development, same distinction NODE_ENV already draws
    // elsewhere in this bootstrap.
    cookieSecure: container.config.nodeEnv === 'production',
  });

  return app;
}
