import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { ValidationError } from '../../../kernel/errors/domain-error.js';
import type { SessionStore } from '../../../kernel/identity/session-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { evaluatePasswordComplexity } from '../domain/validation.js';
import type { PasswordHasher } from '../infrastructure/password-hasher.js';
import type { PasswordResetTokenGenerator } from '../infrastructure/password-reset-token-generator.js';

import type { PasswordResetRepository } from './password-reset-repository.js';

export interface ConfirmPasswordResetInput {
  readonly token: string;
  readonly newPassword: string;
  readonly correlationId: string;
}

/**
 * API §1.8 `POST /auth/password-reset/confirm`. Sets a new password,
 * consumes the token, and revokes every existing session for the account
 * (NFR-SEC-08) — "The user is not signed in automatically" (API §1.8), so
 * this deliberately never issues a new session, unlike login and the SSO
 * callback.
 */
export class ConfirmPasswordResetHandler {
  constructor(
    private readonly resetRepository: PasswordResetRepository,
    private readonly tokenGenerator: PasswordResetTokenGenerator,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessionStore: SessionStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: ConfirmPasswordResetInput): Promise<Result<void, ValidationError>> {
    const complexity = evaluatePasswordComplexity(input.newPassword);
    if (!complexity.satisfiesPolicy) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message:
            'Your password needs at least 10 characters and three of: a lowercase letter, an uppercase letter, a digit, a symbol.',
          fields: [
            ...(complexity.meetsMinimumLength
              ? []
              : [{ field: 'newPassword', rule: 'VR-02', message: 'At least 10 characters' }]),
            ...(complexity.hasLowercase ? [] : [{ field: 'newPassword', rule: 'VR-02', message: 'A lowercase letter' }]),
            ...(complexity.hasUppercase ? [] : [{ field: 'newPassword', rule: 'VR-02', message: 'An uppercase letter' }]),
            ...(complexity.hasDigit ? [] : [{ field: 'newPassword', rule: 'VR-02', message: 'A digit' }]),
            ...(complexity.hasSymbol ? [] : [{ field: 'newPassword', rule: 'VR-02', message: 'A symbol' }]),
          ],
        }),
      );
    }

    const tokenHash = this.tokenGenerator.hash(input.token);
    const validToken = await this.resetRepository.findValidToken(tokenHash, this.clock.now());
    if (validToken === null) {
      return err(
        new ValidationError({
          code: 'RESET_TOKEN_INVALID',
          message: 'That reset link has expired or has already been used. Request a new one.',
        }),
      );
    }

    const newPasswordHash = await this.passwordHasher.hash(input.newPassword);
    const now = this.clock.now();

    await this.resetRepository.updatePasswordHash(validToken.userAccountId, newPasswordHash, now);
    await this.resetRepository.consumeToken(validToken.id, now);
    await this.sessionStore.revokeAllForUser(validToken.userAccountId);
    await this.auditRecorder.recordChange({
      entityType: 'identity.local_credential',
      entityId: validToken.userAccountId,
      action: 'password_reset',
      actorId: validToken.userAccountId,
      correlationId: input.correlationId,
    });

    return ok(undefined);
  }
}
