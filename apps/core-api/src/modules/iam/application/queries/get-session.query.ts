import type { RoleCode } from '@campuscare/shared-types';

import type { CsrfTokenService } from '../../../../kernel/identity/csrf.js';
import type { SessionStore } from '../../../../kernel/identity/session-store.js';
import type { PolicyStore } from '../../../../kernel/policy/policy-store.js';
import type { AuthenticationRepository } from '../authentication-repository.js';
import { resolveIdleTimeoutMinutes } from '../resolve-idle-timeout.js';

export interface SessionSnapshot {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly roles: readonly RoleCode[];
  readonly csrfToken: string;
  readonly sessionExpiresAt: Date;
}

/**
 * `GET /api/v1/auth/session` (API §1.5) and the PEP's per-request subject
 * resolution share this exact sequence — peek the session, load current
 * roles (PRM-15: reflected without re-authentication), touch with the
 * role-correct idle timeout. Kept as one query both call rather than
 * duplicated, so the two can never disagree about what "the current
 * session" means.
 */
export class GetSessionQuery {
  constructor(
    private readonly repository: AuthenticationRepository,
    private readonly sessionStore: SessionStore,
    private readonly csrfTokenService: CsrfTokenService,
    private readonly policyStore: PolicyStore,
  ) {}

  async execute(sessionId: string): Promise<SessionSnapshot | null> {
    const peeked = await this.sessionStore.peek(sessionId);
    if (peeked === null) return null;

    const account = await this.repository.findAccountById(peeked.userAccountId);
    if (account?.status !== 'active') return null;

    const roles = await this.repository.loadActiveRoleCodes(account.id);
    const idleTimeoutMinutes = await resolveIdleTimeoutMinutes(this.policyStore, roles);
    const touched = await this.sessionStore.validateAndTouch(sessionId, idleTimeoutMinutes * 60_000);
    if (touched === null) return null;

    return {
      userId: account.id,
      fullName: account.fullName,
      email: account.email,
      roles,
      csrfToken: this.csrfTokenService.issue(sessionId),
      sessionExpiresAt: touched.expiresAt,
    };
  }
}
