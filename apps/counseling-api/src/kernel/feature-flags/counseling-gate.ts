import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

/**
 * BR-68 / ARCHITECTURE §3.4 — the `counseling.enabled` deployment gate.
 *
 * "When off, every /counseling/api/v1/* route returns 404 (not 403 — a 403
 * would confirm the routes exist)." This runs as an `onRequest` hook, ahead
 * of route matching, so it applies uniformly to every route this service
 * will ever register — including ones added in M6 — without each route
 * needing its own flag check that could be forgotten.
 *
 * When the flag is on, this plugin does nothing: it adds no hook and costs
 * nothing on the request path.
 */
export function createCounselingFeatureGate(isEnabled: boolean): FastifyPluginCallback {
  return fp(
    (app, _opts, done) => {
      if (!isEnabled) {
        app.addHook('onRequest', (request, reply, hookDone) => {
          reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: "We couldn't find that page.",
              correlationId: request.correlationId,
            },
          });
          hookDone();
        });
      }
      done();
    },
    { name: 'counseling-feature-gate' },
  );
}
