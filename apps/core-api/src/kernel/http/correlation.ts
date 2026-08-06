import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { generateCorrelationId } from '../errors/correlation-id.js';

/**
 * Stamps every request with a correlation ID before any handler or the PEP
 * runs — API §0.4: "always correlated," on every branch including denials
 * and 5xx failures. One place generates it and one place reads it
 * ({@link getCorrelationId}), so a handler can never accidentally use a
 * different id than the one that ends up in the error envelope.
 *
 * `fastify-plugin` wraps this so the decoration and hook apply to the whole
 * app rather than being scoped to whatever plugin registers it first —
 * Fastify's encapsulation is usually the right default, but a
 * request-scoped concern used by every route is the exception.
 */
declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

const correlationIdPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.decorateRequest('correlationId', '');
  app.addHook('onRequest', (request, _reply, hookDone) => {
    request.correlationId = generateCorrelationId();
    hookDone();
  });
  done();
};

export const registerCorrelationId = fp(correlationIdPlugin, { name: 'correlation-id' });

export function getCorrelationId(request: FastifyRequest): string {
  return request.correlationId;
}
