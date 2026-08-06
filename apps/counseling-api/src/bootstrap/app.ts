import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { createCounselingFeatureGate } from '../kernel/feature-flags/counseling-gate.js';
import { registerCorrelationId } from '../kernel/http/correlation.js';
import { registerErrorHandling } from '../kernel/http/error-handler.js';

import type { AppConfig } from './config.js';

/**
 * No business routes are registered here — none exist yet. Counseling
 * intake and case management are M6 work. What this builds is the platform
 * every future counseling route will run inside: correlation IDs, CORS, the
 * error envelope, and the `counseling.enabled` gate (BR-68) that makes every
 * route — including ones that don't exist yet — 404 while the flag is off.
 *
 * Fastify builds its own internal logger from this config object rather
 * than taking an externally-constructed pino instance — see
 * core-api/src/bootstrap/app.ts for why passing an instance directly
 * creates a pino/Fastify typing conflict unrelated to the actual logging
 * behaviour. Since nothing in this service logs outside of a request
 * context yet, there is no separate application-level logger to keep in
 * sync with this one.
 */
export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  void app.register(registerCorrelationId);
  void app.register(cors, { origin: config.webAppOrigin, credentials: true });
  void app.register(createCounselingFeatureGate(config.featureCounselingEnabled));

  registerErrorHandling(app);

  return app;
}
