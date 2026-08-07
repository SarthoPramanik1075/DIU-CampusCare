import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { ValidationError } from '../../../kernel/errors/domain-error.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isDiuInstitutionalEmail } from '../domain/validation.js';
import type { PasswordResetTokenGenerator } from '../infrastructure/password-reset-token-generator.js';

import type { AuthenticationRepository } from './authentication-repository.js';
import type { PasswordResetRepository } from './password-reset-repository.js';

export interface RequestPasswordResetInput {
  readonly email: string;
  readonly correlationId: string;
}

/**
 * API §1.7 `POST /auth/password-reset/request`. "Always 202, always this
 * message, whether or not the account exists and whether or not it uses
 * password authentication" — API §0.4 rule 2 applied to the reset flow
 * specifically. There is deliberately no `Result` error variant for "no
 * such account": the success path and the silent-no-op path return the
 * identical `ok(undefined)`, which is what makes them indistinguishable to
 * the caller by construction, not by a convention this handler could
 * later forget.
 */
export class RequestPasswordResetHandler {
  constructor(
    private readonly authRepository: Pick<AuthenticationRepository, 'findAccountWithCredentialByEmail'>,
    private readonly resetRepository: PasswordResetRepository,
    private readonly tokenGenerator: PasswordResetTokenGenerator,
    private readonly policyStore: PolicyStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
    private readonly webAppOrigin: string,
    private readonly clock: Clock,
  ) {}

  async execute(input: RequestPasswordResetInput): Promise<Result<void, ValidationError>> {
    if (!isDiuInstitutionalEmail(input.email)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Use your DIU university email address.',
          fields: [{ field: 'email', rule: 'VR-01', message: 'Must be a DIU institutional email address' }],
        }),
      );
    }

    const account = await this.authRepository.findAccountWithCredentialByEmail(input.email);
    if (account !== null) {
      const { rawToken, tokenHash } = this.tokenGenerator.generate();
      const expiryMinutes = await this.policyStore.getRequiredInteger('auth.passwordReset.expiryMinutes');
      const expiresAt = new Date(this.clock.now().getTime() + expiryMinutes * 60_000);

      await this.resetRepository.createToken({ userAccountId: account.id, tokenHash, expiresAt });
      await this.auditRecorder.recordChange({
        entityType: 'identity.password_reset_token',
        action: 'requested',
        actorId: account.id,
        correlationId: input.correlationId,
      });

      const resetLink = `${this.webAppOrigin}/reset-password/confirm?token=${rawToken}`;
      await this.enqueueNotification({
        recipientId: account.id,
        templateKey: 'password_reset_requested',
        payload: { resetLink },
        channel: 'email',
        correlationId: input.correlationId,
      });
    }

    return ok(undefined);
  }
}
