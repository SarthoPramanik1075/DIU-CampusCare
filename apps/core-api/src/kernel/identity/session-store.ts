import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../infrastructure/database/client.js';
import type { Clock } from '../clock/clock.js';


/**
 * Server-side, revocable sessions — API §0.2, FR-AUTH-06/07, NFR-SEC-08.
 *
 * PRM-15 requires a permission *reduction* to take effect on a user's next
 * request without forcing re-authentication. A self-contained token (a
 * signed JWT, say) cannot be revoked mid-life without a server-side
 * revocation list — at which point the session store this class implements
 * has been reinvented anyway, with a worse failure mode. So the session
 * itself is the source of truth, identified by an opaque id that means
 * nothing without the row it names.
 *
 * The idle-timeout duration is never hardcoded here (DR-4): FR-AUTH-06 gives
 * different timeouts to different roles (30 min students, 15 min CNP/ADM),
 * which is a configured value the caller fetches from `PolicyStore` and
 * passes in on every call. This class has no opinion on what the duration
 * should be — only on what it means for a session to have one.
 */
export interface SessionRecord {
  readonly id: string;
  readonly userAccountId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  readonly clientFingerprint: string | null;
}

export class SessionStore {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly clock: Clock,
  ) {}

  /**
   * NFR-SEC-08: sessions are regenerated on login. The caller is expected to
   * have already revoked any prior session for this user (see
   * {@link revokeAllForUser}) before calling this on a fresh sign-in.
   */
  async create(input: {
    readonly userAccountId: string;
    readonly idleTimeoutMs: number;
    readonly clientFingerprint?: string | null;
  }): Promise<SessionRecord> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + input.idleTimeoutMs);
    const id = uuidv7();

    await this.db
      .insertInto('identity.user_session')
      .values({
        id,
        user_account_id: input.userAccountId,
        issued_at: now,
        expires_at: expiresAt,
        last_seen_at: now,
        client_fingerprint: input.clientFingerprint ?? null,
      })
      .execute();

    return {
      id,
      userAccountId: input.userAccountId,
      issuedAt: now,
      expiresAt,
      lastSeenAt: now,
      clientFingerprint: input.clientFingerprint ?? null,
    };
  }

  /**
   * Validates a session and, if it is still usable, slides its idle-timeout
   * window forward by `idleTimeoutMs` from now (FR-AUTH-06's "idle" timeout
   * is measured from last activity, not from login).
   *
   * Returns `null` uniformly for an unknown session id, a revoked one, and
   * an expired one — the caller cannot distinguish "never existed" from
   * "existed but is no longer valid" from this return value alone, which
   * mirrors API §0.4's rule that an authentication failure must not confirm
   * what it is refusing.
   */
  async validateAndTouch(sessionId: string, idleTimeoutMs: number): Promise<SessionRecord | null> {
    const now = this.clock.now();

    const existing = await this.db
      .selectFrom('identity.user_session')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();

    if (existing === undefined) return null;
    if (existing.revoked_at !== null) return null;
    if (existing.expires_at.getTime() <= now.getTime()) return null;

    const newExpiresAt = new Date(now.getTime() + idleTimeoutMs);
    await this.db
      .updateTable('identity.user_session')
      .set({ last_seen_at: now, expires_at: newExpiresAt })
      .where('id', '=', sessionId)
      .execute();

    return {
      id: existing.id,
      userAccountId: existing.user_account_id,
      issuedAt: existing.issued_at,
      expiresAt: newExpiresAt,
      lastSeenAt: now,
      clientFingerprint: existing.client_fingerprint,
    };
  }

  /** FR-AUTH-07: explicit logout terminates the session immediately, on every role. */
  async revoke(sessionId: string): Promise<void> {
    await this.db
      .updateTable('identity.user_session')
      .set({ revoked_at: this.clock.now() })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /**
   * NFR-SEC-08: regenerated "on login and on any privilege change" implies
   * the old session(s) must stop working, not merely that a new one is
   * issued alongside them. Called before {@link create} on login, and
   * whenever a role grant or revocation changes what a live session may do.
   */
  async revokeAllForUser(userAccountId: string): Promise<void> {
    await this.db
      .updateTable('identity.user_session')
      .set({ revoked_at: this.clock.now() })
      .where('user_account_id', '=', userAccountId)
      .where('revoked_at', 'is', null)
      .execute();
  }
}
