import { randomBytes } from 'node:crypto';

import type { AuthenticatedRoleCode } from '@campuscare/shared-types';

import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { DomainRuleViolation, ValidationError } from '../../../kernel/errors/domain-error.js';
import type { EnqueueNotificationInput } from '../../../kernel/notifications/enqueue-notification.js';
import type { PolicyStore } from '../../../kernel/policy/policy-store.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isDiuInstitutionalEmail, isNonEmptyAfterTrim } from '../domain/validation.js';
import type { PasswordHasher } from '../infrastructure/password-hasher.js';
import type { PasswordResetTokenGenerator } from '../infrastructure/password-reset-token-generator.js';

import type { AccountAdminRepository, AccountDetail } from './account-admin-repository.js';
import type { PasswordResetRepository } from './password-reset-repository.js';

export interface CreateAccountCommandInput {
  readonly email: string;
  readonly fullName: string;
  readonly authMethod: 'sso' | 'local';
  readonly roles: readonly AuthenticatedRoleCode[];
  readonly isClinicalStaff: boolean;
  readonly locationId: string | null;
  readonly createdBy: string;
  readonly correlationId: string;
}

function roleNotAssignableError(reason: string): ValidationError {
  return new ValidationError({
    code: 'ROLE_NOT_ASSIGNABLE',
    message: 'The Counseling Professional role can only be given to an account marked as clinical staff.',
    fields: [{ field: 'roles', rule: 'VR-04', message: reason }],
  });
}

/**
 * `POST /api/v1/users` (API §1.3). There is no self-registration path for
 * any non-student role (FR-AUTH-02, BR-05) — every account this handler
 * creates was decided into existence by an Administrator, which is also
 * why a `local` account gets a password nobody, including this handler,
 * ever knows: a random placeholder hash locks the account out of every
 * login until the emailed first-use link (the same mechanics as `POST
 * /auth/password-reset/request`) is used to set a real one.
 */
export class CreateAccountHandler {
  constructor(
    private readonly repository: AccountAdminRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly passwordResetRepository: PasswordResetRepository,
    private readonly passwordResetTokenGenerator: PasswordResetTokenGenerator,
    private readonly policyStore: PolicyStore,
    private readonly auditRecorder: AuditRecorder,
    private readonly enqueueNotification: (input: EnqueueNotificationInput) => Promise<void>,
    private readonly webAppOrigin: string,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateAccountCommandInput): Promise<Result<AccountDetail, ValidationError | DomainRuleViolation>> {
    if (!isDiuInstitutionalEmail(input.email)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Use a DIU institutional email address.',
          fields: [{ field: 'email', rule: 'VR-01', message: 'Must be a DIU institutional email address' }],
        }),
      );
    }
    if (!isNonEmptyAfterTrim(input.fullName)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a full name.',
          fields: [{ field: 'fullName', rule: 'VALIDATION_FAILED', message: 'Non-empty after trimming' }],
        }),
      );
    }
    if (input.roles.length === 0 || input.roles.includes('STU')) {
      return err(
        roleNotAssignableError(
          input.roles.includes('STU') ? 'Student accounts are provisioned by SSO, not this endpoint' : 'At least one role is required',
        ),
      );
    }
    if (input.roles.includes('CNP') && !input.isClinicalStaff) {
      await this.auditRecorder.recordDenial({
        actorId: input.createdBy,
        attemptedRole: 'ADM',
        resource: 'user-accounts-and-roles',
        operation: 'create',
        reason: 'ROLE_NOT_ASSIGNABLE',
        correlationId: input.correlationId,
      });
      return err(roleNotAssignableError('CNP requires isClinicalStaff'));
    }

    if (await this.repository.isEmailRegistered(input.email)) {
      return err(
        new DomainRuleViolation({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account with that email already exists.',
        }),
      );
    }

    const passwordHash =
      input.authMethod === 'local' ? await this.passwordHasher.hash(randomBytes(32).toString('base64url')) : null;

    const result = await this.repository.createAccount({
      email: input.email,
      fullName: input.fullName.trim(),
      authMethod: input.authMethod,
      passwordHash,
      roles: input.roles,
      isClinicalStaff: input.isClinicalStaff,
      locationId: input.locationId,
      createdBy: input.createdBy,
    });

    if (result.outcome === 'email_taken') {
      // A race against another request between the check above and the
      // insert — the unique constraint is the real guard; this is just
      // surfacing it the same way as the pre-check.
      return err(
        new DomainRuleViolation({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account with that email already exists.',
        }),
      );
    }

    if (input.authMethod === 'local') {
      const { rawToken, tokenHash } = this.passwordResetTokenGenerator.generate();
      const expiryMinutes = await this.policyStore.getRequiredInteger('auth.passwordReset.expiryMinutes');
      const expiresAt = new Date(this.clock.now().getTime() + expiryMinutes * 60_000);
      await this.passwordResetRepository.createToken({
        userAccountId: result.account.userId,
        tokenHash,
        expiresAt,
      });
      await this.enqueueNotification({
        recipientId: result.account.userId,
        templateKey: 'password_reset_requested',
        payload: { resetLink: `${this.webAppOrigin}/reset-password/confirm?token=${rawToken}` },
        channel: 'email',
        correlationId: input.correlationId,
      });
    }

    await this.auditRecorder.recordChange({
      entityType: 'identity.user_account',
      entityId: result.account.userId,
      action: 'created',
      actorId: input.createdBy,
      correlationId: input.correlationId,
    });

    return ok(result.account);
  }
}
