import { InfrastructureError, ValidationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { SsoAuthorizationRequest, SsoClient } from '../sso-client.js';

/**
 * API §1.1 `GET /auth/sso/login`. Lives under `application/queries/`
 * (DR-7): it writes nothing — no session, no account, no audit-worthy
 * state change, only a signed random `state`/PKCE pair and a redirect URL
 * — which is exactly the property that makes a handler a query rather
 * than a command in this codebase's convention (see
 * `list-active-announcements.query.ts`).
 *
 * `redirectTo` must be a same-origin relative path — "Absolute URLs and
 * protocol-relative values are rejected — an open redirect here would
 * hand an attacker a credible phishing surface."
 */
function isSafeRelativeRedirect(redirectTo: string): boolean {
  return redirectTo.startsWith('/') && !redirectTo.startsWith('//');
}

export class SsoLoginHandler {
  constructor(private readonly ssoClient: SsoClient) {}

  async execute(redirectTo: string | undefined): Promise<Result<SsoAuthorizationRequest, ValidationError | InfrastructureError>> {
    if (redirectTo !== undefined && !isSafeRelativeRedirect(redirectTo)) {
      return err(
        new ValidationError({
          code: 'INVALID_REDIRECT',
          message: "That link isn't valid. Return to the DIU CampusCare home page and try again.",
        }),
      );
    }

    if (!this.ssoClient.isConfigured) {
      return err(
        new InfrastructureError({
          code: 'SSO_UNAVAILABLE',
          message: "Sign-in with your DIU account isn't available right now. You can sign in with your email and password instead.",
          retryable: true,
        }),
      );
    }

    return ok(await this.ssoClient.createAuthorizationRequest(redirectTo));
  }
}
