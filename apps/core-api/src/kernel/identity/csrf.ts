import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * CSRF protection — API §0.2.
 *
 * "Every state-changing request additionally requires a `X-CSRF-Token`
 * header matching the value issued by `GET /api/v1/auth/session`."
 *
 * Rather than storing a token alongside the session row, the token is
 * derived from the session id itself via HMAC: `issue()` and `verify()` both
 * recompute it from the session id and a server-held secret, so there is
 * nothing extra to store, migrate, or let go stale. Knowing the session id
 * (as the caller does, from the cookie) is not enough to derive the token
 * without the secret — a `SameSite=Lax` cookie sent along with a
 * cross-origin form submission does not, on its own, hand the attacker the
 * header value this class expects.
 */
export class CsrfTokenService {
  private readonly secret: string;

  constructor(secret: string) {
    if (secret.length < 32) {
      throw new Error('CSRF secret must be at least 32 characters.');
    }
    this.secret = secret;
  }

  issue(sessionId: string): string {
    return createHmac('sha256', this.secret).update(sessionId).digest('base64url');
  }

  /** Constant-time comparison — a timing side-channel here would leak the valid token one byte at a time. */
  verify(sessionId: string, candidateToken: string | undefined): boolean {
    if (candidateToken === undefined || candidateToken === '') return false;

    const expected = Buffer.from(this.issue(sessionId));
    const candidate = Buffer.from(candidateToken);
    if (expected.length !== candidate.length) return false;

    return timingSafeEqual(expected, candidate);
  }
}
