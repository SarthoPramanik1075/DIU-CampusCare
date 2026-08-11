import type { FastifyRequest } from 'fastify';

/**
 * The `Idempotency-Key` header (API §0.6/§0.7) — command-buffer replay for
 * the whitelisted bufferable endpoints (`POST /appointments/{id}/check-in`,
 * `.../advance`, `.../no-show`, `POST /walk-ins`). Deliberately just the
 * header read: whether a given value counts as "this exact command already
 * applied" is domain-specific (a check-in's replay condition differs from
 * an advance's), so that decision stays in each module's own handler,
 * against its own stored `idempotency_key` column — this file only ever
 * answers "did the caller send one."
 */
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export function getIdempotencyKey(request: FastifyRequest): string | null {
  const value = request.headers[IDEMPOTENCY_KEY_HEADER];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
