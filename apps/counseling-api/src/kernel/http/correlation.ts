import { randomUUID } from 'node:crypto';

import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Stamps every request with a correlation ID before any hook or handler
 * runs — API §0.4.
 *
 * This is a deliberate, small duplication of core-api's identically-named
 * file, not a shared dependency. ADR-001 draws counseling-api and core-api
 * as genuinely independent deployables with their own composition roots and
 * their own kernels; importing core-api's kernel here — even for something
 * as neutral as this — would create exactly the kind of build-time coupling
 * between the two services that the physical separation exists to avoid.
 * `@campuscare/shared-types` remains the one and only shared package,
 * scoped to wire-format types that carry no behaviour.
 */
declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

const correlationIdPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.decorateRequest('correlationId', '');
  app.addHook('onRequest', (request, _reply, hookDone) => {
    request.correlationId = randomUUID();
    hookDone();
  });
  done();
};

export const registerCorrelationId = fp(correlationIdPlugin, { name: 'correlation-id' });

export function getCorrelationId(request: FastifyRequest): string {
  return request.correlationId;
}
