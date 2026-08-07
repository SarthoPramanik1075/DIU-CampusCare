import { toBstIsoString } from '@campuscare/shared-types';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { formatBstTime } from '../domain/formatting.js';
import { isDiuInstitutionalEmail } from '../domain/validation.js';
import type { PasswordHasher } from '../infrastructure/password-hasher.js';

import type { AuthenticationRepository } from './authentication-repository.js';
import type { IssuedSession, SessionIssuer } from './session-issuer.js';

export interface LoginWithPasswordInput {
  readonly email: string;
  readonly password: string;
  readonly sourceAddress: string | null;
  readonly correlationId: string;
}

export type LoginSuccess = IssuedSession;

/**
 * A string that is never a real password, hashed once and cached, so the
 * "no such account" and "account has no password credential" paths spend
 * roughly the same time as a genuine wrong-password check (API §0.4 rule 2
 * / ARCHITECTURE §7.2 — a faster response for a nonexistent account is a
 * timing side-channel that enumerates accounts).
 */
const TIMING_PARITY_PASSWORD = 'this-is-never-a-real-password-8f3a1c';

export class LoginWithPasswordHandler {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly repository: AuthenticationRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessionIssuer: SessionIssuer,
    private readonly policyStore: PolicyStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
    private readonly clock: Clock,
  ) {}

  async execute(input: LoginWithPasswordInput): Promise<Result<LoginSuccess, ValidationError | AuthorizationError>> {
    if (!isDiuInstitutionalEmail(input.email)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Use your DIU university email address.',
          fields: [{ field: 'email', rule: 'VR-01', message: 'Must be a DIU institutional email address' }],
        }),
      );
    }

    const account = await this.repository.findAccountWithCredentialByEmail(input.email);

    if (account === null) {
      await this.spendTimingParity(input.password);
      await this.repository.recordLoginAttempt({
        emailAttempted: input.email,
        userAccountId: null,
        succeeded: false,
        sourceAddress: input.sourceAddress,
      });
      return err(this.invalidCredentialsError());
    }

    const now = this.clock.now();
    if (account.lockedUntil !== null && account.lockedUntil.getTime() > now.getTime()) {
      await this.repository.recordLoginAttempt({
        emailAttempted: input.email,
        userAccountId: account.id,
        succeeded: false,
        sourceAddress: input.sourceAddress,
      });
      return err(this.accountLockedError(account.lockedUntil));
    }

    const passwordMatches = await this.passwordHasher.verify(account.passwordHash, input.password);
    if (!passwordMatches) {
      return err(await this.handleFailedPassword(account, input));
    }

    // Password correct — reset the counter regardless of what happens next;
    // a correct password is proof this was not a guessing attempt, even if
    // the account turns out not to be active.
    await this.repository.resetFailedAttempts(account.id);

    if (account.status !== 'active') {
      await this.repository.recordLoginAttempt({
        emailAttempted: input.email,
        userAccountId: account.id,
        succeeded: false,
        sourceAddress: input.sourceAddress,
      });
      return err(
        new AuthorizationError({
          code: 'ACCOUNT_NOT_ACTIVE',
          message: "This account isn't active. Contact DIU IT for help.",
          httpStatus: 403,
        }),
      );
    }

    const session = await this.sessionIssuer.issueFor(account);

    await this.repository.recordLoginAttempt({
      emailAttempted: input.email,
      userAccountId: account.id,
      succeeded: true,
      sourceAddress: input.sourceAddress,
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

  private async handleFailedPassword(
    account: { readonly id: string; readonly failedAttempts: number },
    input: LoginWithPasswordInput,
  ): Promise<AuthorizationError> {
    const maxAttempts = await this.policyStore.getRequiredInteger('auth.lockout.maxAttempts');
    const willLock = account.failedAttempts + 1 >= maxAttempts;

    let lockedUntil: Date | null = null;
    if (willLock) {
      const lockoutMinutes = await this.policyStore.getRequiredInteger('auth.lockout.durationMinutes');
      lockedUntil = new Date(this.clock.now().getTime() + lockoutMinutes * 60_000);
    }

    await this.repository.recordFailedAttempt(account.id, lockedUntil);
    await this.repository.recordLoginAttempt({
      emailAttempted: input.email,
      userAccountId: account.id,
      succeeded: false,
      sourceAddress: input.sourceAddress,
    });

    if (lockedUntil === null) {
      return this.invalidCredentialsError();
    }

    // FR-AUTH-14: "shall notify the account holder by email." The channel
    // is real; whether it is actually delivered depends on M8's dispatcher
    // and `FEATURE_EMAIL_ENABLED` — this call's job ends at "queued".
    await this.enqueueNotification({
      recipientId: account.id,
      templateKey: 'account_locked',
      payload: { unlockAt: formatBstTime(lockedUntil) },
      channel: 'email',
      correlationId: input.correlationId,
    });

    return this.accountLockedError(lockedUntil);
  }

  private async spendTimingParity(candidate: string): Promise<void> {
    this.dummyHash ??= this.passwordHasher.hash(TIMING_PARITY_PASSWORD);
    await this.passwordHasher.verify(await this.dummyHash, candidate);
  }

  private invalidCredentialsError(): AuthorizationError {
    return new AuthorizationError({
      code: 'INVALID_CREDENTIALS',
      message: "That email address and password don't match. Check both and try again.",
      httpStatus: 401,
    });
  }

  private accountLockedError(unlockAt: Date): AuthorizationError {
    return new AuthorizationError({
      code: 'ACCOUNT_LOCKED',
      message: `Too many attempts. Your account is locked until ${formatBstTime(unlockAt)}. We've emailed you about this.`,
      httpStatus: 423,
      details: { unlockAt: toBstIsoString(unlockAt) },
    });
  }
}
