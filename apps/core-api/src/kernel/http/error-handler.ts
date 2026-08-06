import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

import { mapErrorToHttp } from '../errors/http-error-mapper.js';

import { getCorrelationId } from './correlation.js';

/**
 * The single point where a thrown error, or an unmatched route, becomes an
 * HTTP response. Both paths go through {@link mapErrorToHttp}, so a 404 for
 * a route that does not exist and a `NOT_FOUND` thrown deliberately by a
 * handler produce byte-identical envelopes (API §0.4 rule 2 — a genuinely
 * missing route must not be distinguishable from a resource a handler
 * declined to confirm).
 *
 * Registered directly on the app (not via `fastify-plugin`) because
 * `setErrorHandler` / `setNotFoundHandler` are already whole-app concerns in
 * Fastify — encapsulation has nothing to opt out of here.
 */
export function registerErrorHandling(app: FastifyInstance, logger: Logger): void {
  app.setErrorHandler((error, request, reply) => {
    const correlationId = getCorrelationId(request);
    const { status, body } = mapErrorToHttp(error, correlationId);

    if (status >= 500) {
      logger.error({ err: error, correlationId, path: request.url }, 'unhandled error');
    } else {
      logger.info({ code: body.error.code, correlationId, path: request.url }, 'request failed');
    }

    reply.status(status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const correlationId = getCorrelationId(request);
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: "We couldn't find that page.",
        correlationId,
      },
    });
  });
}
