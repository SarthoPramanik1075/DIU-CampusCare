import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';

/**
 * FR-AUTH-07: "terminate the session immediately, on every role." API §1.4:
 * "Logging out twice is not an error" — `SessionStore.revoke` is already
 * idempotent (its `WHERE revoked_at IS NULL` clause matches zero rows on a
 * second call rather than failing), so this handler has nothing extra to
 * guard.
 */
export class LogoutHandler {
  constructor(
    private readonly sessionStore: SessionStore,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: { readonly sessionId: string; readonly userAccountId: string; readonly correlationId: string }): Promise<void> {
    await this.sessionStore.revoke(input.sessionId);
    await this.auditRecorder.recordChange({
      entityType: 'identity.user_session',
      entityId: input.sessionId,
      action: 'logout',
      actorId: input.userAccountId,
      correlationId: input.correlationId,
    });
  }
}
