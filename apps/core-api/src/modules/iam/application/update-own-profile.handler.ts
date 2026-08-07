import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { ConflictError, ValidationError } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';
import { isNonEmptyAfterTrim } from '../domain/validation.js';

import type { AuthenticationRepository } from './authentication-repository.js';
import type { OwnProfileRepository } from './own-profile-repository.js';
import { assembleOwnProfile, type OwnProfile } from './queries/get-own-profile.query.js';

export interface UpdateOwnProfileInput {
  readonly userAccountId: string;
  readonly fullName: string | undefined;
  readonly expectedVersion: number;
  readonly correlationId: string;
}

/**
 * `PATCH /api/v1/me` (API §1.2). `email`, `status`, `roles` and
 * `studentRef` are rejected as `FIELD_NOT_EDITABLE` at the route layer
 * (`auth.routes.ts` — same "shape-check before this handler runs" split as
 * login's required-field check) since detecting a disallowed key needs no
 * domain state; this handler owns the two rules that do: VR-92 optimistic
 * concurrency and `fullName` non-emptiness.
 */
export class UpdateOwnProfileHandler {
  constructor(
    private readonly repository: OwnProfileRepository,
    private readonly authRepository: Pick<AuthenticationRepository, 'loadActiveRoleCodes'>,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: UpdateOwnProfileInput): Promise<Result<OwnProfile, ValidationError | ConflictError>> {
    if (input.fullName !== undefined && !isNonEmptyAfterTrim(input.fullName)) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter your full name.',
          fields: [{ field: 'fullName', rule: 'VR-92', message: 'Non-empty after trimming' }],
        }),
      );
    }

    const outcome = await this.repository.updateFullName({
      userAccountId: input.userAccountId,
      fullName: input.fullName?.trim(),
      expectedVersion: input.expectedVersion,
      now: this.clock.now(),
    });

    if (outcome.outcome === 'stale') {
      // EC-19: re-present the current state rather than merely rejecting.
      const current = await this.repository.findAccountById(input.userAccountId);
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else updated this a moment ago. Here is the current version — review it and try again.',
          ...(current === null
            ? {}
            : { details: { current: await assembleOwnProfile(current, this.repository, this.authRepository) } }),
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'identity.user_account',
      entityId: input.userAccountId,
      action: 'profile_updated',
      actorId: input.userAccountId,
      correlationId: input.correlationId,
    });

    return ok(await assembleOwnProfile(outcome.account, this.repository, this.authRepository));
  }
}
