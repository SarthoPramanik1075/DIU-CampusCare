/**
 * Redaction is a component, not a convention — ARCHITECTURE §11.2.
 *
 * These paths cover fields that are sensitive in every context: credentials,
 * session identifiers, and the standard headers that carry them. This list
 * is deliberately NOT where domain-sensitive fields belong — a counseling
 * note body or a reason-for-visit note has no business being logged as a
 * structured field in the first place, and no redaction list can be trusted
 * to enumerate every such field a future module might add.
 *
 * NFR-MNT-03: logs must be sufficient to diagnose a failed booking, check-in
 * or dispensing event, without containing counseling content or personal
 * health information. The mechanism for that guarantee is that domain
 * modules log identifiers and outcomes, not payloads — this list is the
 * second line of defence, not the first.
 *
 * Pino's `redact` accepts dot/bracket paths with wildcards; see
 * https://getpino.io/#/docs/redaction.
 */
export const REDACTED_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.passwordHash',
  '*.password_hash',
  '*.sessionCookie',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.csrfToken',
  '*.internalServiceToken',
];

export const REDACTION_CENSOR = '[REDACTED]';
