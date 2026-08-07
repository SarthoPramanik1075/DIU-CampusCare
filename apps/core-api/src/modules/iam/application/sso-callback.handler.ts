import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import { AuthorizationError, InfrastructureError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';

import type { AuthenticationRepository } from './authentication-repository.js';
import type { IssuedSession, SessionIssuer } from './session-issuer.js';
import type { SsoClient } from './sso-client.js';

export interface SsoCallbackInput {
  readonly callbackUrl: URL;
  readonly queryState: string | undefined;
  readonly preSessionState: string;
  readonly codeVerifier: string;
  readonly correlationId: string;
}

/**
 * API §1.2 `GET /auth/sso/callback`. The pre-session cookie from
 * `/auth/sso/login` is required and consumed — the route layer reads and
 * clears it before this handler ever runs; `preSessionState`/`codeVerifier`
 * here are what that cookie held.
 */
export class SsoCallbackHandler {
  constructor(
    private readonly ssoClient: SsoClient,
    private readonly repository: AuthenticationRepository,
    private readonly sessionIssuer: SessionIssuer,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(input: SsoCallbackInput): Promise<Result<IssuedSession, AuthorizationError | InfrastructureError>> {
    // CSRF on the authorization code flow: state must match exactly.
    if (input.queryState === undefined || input.queryState !== input.preSessionState) {
      return err(
        new AuthorizationError({
          code: 'SSO_STATE_MISMATCH',
          message: "Your sign-in couldn't be completed. Start again from the sign-in page.",
          httpStatus: 403,
        }),
      );
    }

    let identity;
    try {
      identity = await this.ssoClient.completeLogin({
        callbackUrl: input.callbackUrl,
        codeVerifier: input.codeVerifier,
        expectedState: input.preSessionState,
      });
    } catch {
      // NFR-SEC-07: the underlying cause (network failure, a rejected
      // token exchange, a malformed IdP response) is never exposed —
      // only that sign-in did not complete.
      return err(
        new InfrastructureError({
          code: 'SSO_EXCHANGE_FAILED',
          message: "Sign-in couldn't be completed. Please try again.",
          retryable: true,
        }),
      );
    }

    const account = await this.repository.findOrProvisionBySsoSubject(identity);

    if (account.status !== 'active') {
      await this.repository.recordLoginAttempt({
        emailAttempted: identity.email,
        userAccountId: account.id,
        succeeded: false,
        sourceAddress: null,
      });
      return err(
        new AuthorizationError({
          code: 'ACCOUNT_NOT_ACTIVE',
          message: "This account isn't active. Contact the medical centre or DIU IT for help.",
          httpStatus: 403,
        }),
      );
    }

    const session = await this.sessionIssuer.issueFor(account);

    await this.repository.recordLoginAttempt({
      emailAttempted: identity.email,
      userAccountId: account.id,
      succeeded: true,
      sourceAddress: null,
    });
    await this.auditRecorder.recordChange({
      entityType: 'identity.user_session',
      entityId: session.sessionId,
      action: 'login',
      actorId: account.id,
      actorRole: session.roles[0] ?? null,
      correlationId: input.correlationId,
    });

    return ok(session);
  }
}
