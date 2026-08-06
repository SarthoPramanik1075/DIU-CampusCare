import type { ErrorResponse } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';

import { getCorrelationId } from './correlation.js';

/**
 * Every thrown error becomes an `INTERNAL_ERROR` 500 with a generic,
 * non-leaking message (NFR-SEC-07) — there is no `DomainError` taxonomy in
 * this service yet, because nothing here deliberately throws a typed
 * business error: the counseling intake and case-management logic that
 * would (VR-75's crisis gate, VR-74's duplicate-request rule, and the rest)
 * is M6 work. This is the complete and honest behaviour for a service with
 * no domain logic yet, not a stand-in for a mapper that is missing — when
 * M6 adds real validation and business-rule errors, this file grows a
 * taxonomy the same shape as core-api's, mapping each class to its own
 * status, exactly as `mapErrorToHttp` does there.
 *
 * Logs via `request.log` — Fastify's own request-scoped child logger —
 * rather than a separately injected instance: it is already correlated to
 * the request and already carries the redaction configuration passed to
 * `Fastify({ logger: {...} })` at construction, with no second logger to
 * keep in sync.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const correlationId = getCorrelationId(request);
    request.log.error({ err: error, correlationId, path: request.url }, 'unhandled error');

    const body: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Your data is safe.',
        correlationId,
      },
    };
    reply.status(500).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const correlationId = getCorrelationId(request);
    const body: ErrorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: "We couldn't find that page.",
        correlationId,
      },
    };
    reply.status(404).send(body);
  });
}
