import { randomUUID } from 'node:crypto';

/**
 * A correlation ID — API §0.4. Present on every error response, quotable by
 * the user, traceable in logs (NFR-MNT-03). The exact format is not
 * contractually specified beyond "a string"; a UUID is unique without a
 * coordinating counter and needs no explanation to a user reading it aloud.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}
