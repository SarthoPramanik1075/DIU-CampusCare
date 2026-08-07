import type { RoleCode } from '@campuscare/shared-types';

import type { CsrfTokenService } from '../../../kernel/identity/csrf.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';

import type { AuthenticationRepository } from './authentication-repository.js';
import { resolveIdleTimeoutMinutes } from './resolve-idle-timeout.js';

export interface IssuedSession {
  readonly userId: string;
  readonly fullName: string;
  readonly roles: readonly RoleCode[];
  readonly sessionId: string;
  readonly csrfToken: string;
  readonly sessionExpiresAt: Date;
  readonly idleTimeoutMinutes: number;
}

/**
 * The "an account is now authenticated, make it a session" step — identical
 * regardless of *how* the account was authenticated, which is why it is
 * factored out rather than duplicated between `LoginWithPasswordHandler`
 * and the SSO callback: NFR-SEC-08's "regenerate on login" and FR-AUTH-06's
 * role-based idle timeout must hold exactly the same way on both paths.
 */
export class SessionIssuer {
  constructor(
    private readonly repository: Pick<AuthenticationRepository, 'loadActiveRoleCodes'>,
    private readonly sessionStore: SessionStore,
    private readonly csrfTokenService: CsrfTokenService,
    private readonly policyStore: PolicyStore,
  ) {}

  async issueFor(account: { readonly id: string; readonly fullName: string }): Promise<IssuedSession> {
    const roles = await this.repository.loadActiveRoleCodes(account.id);

    // NFR-SEC-08: sessions are regenerated on login.
    await this.sessionStore.revokeAllForUser(account.id);
    const idleTimeoutMinutes = await resolveIdleTimeoutMinutes(this.policyStore, roles);
    const session = await this.sessionStore.create({
      userAccountId: account.id,
      idleTimeoutMs: idleTimeoutMinutes * 60_000,
    });
    const csrfToken = this.csrfTokenService.issue(session.id);

    return {
      userId: account.id,
      fullName: account.fullName,
      roles,
      sessionId: session.id,
      csrfToken,
      sessionExpiresAt: session.expiresAt,
      idleTimeoutMinutes,
    };
  }
}
