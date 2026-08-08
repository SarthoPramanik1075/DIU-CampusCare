import type { AuditRecorder } from '../../../kernel/audit/audit-recorder.js';
import type { Clock } from '../../../kernel/clock/clock.js';
import { AuthorizationError, ConflictError, DomainRuleViolation } from '../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../kernel/shared/result.js';

import type { ClinicSessionListItem, ClinicSessionRepository } from './clinic-session-repository.js';

export interface StartSessionCommandInput {
  readonly sessionId: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
}

export function clinicSessionNotFoundForLifecycleError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That session could not be found.', httpStatus: 404 });
}

/** `POST /api/v1/sessions/{id}/start` (API §3.3, EC-02). Resuming from `interrupted` is the same call as the first start — the repository never overwrites an already-set `actuallyStartedAt`. */
export class StartSessionHandler {
  constructor(
    private readonly repository: ClinicSessionRepository,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async execute(input: StartSessionCommandInput): Promise<Result<ClinicSessionListItem, ConflictError | DomainRuleViolation | AuthorizationError>> {
    const outcome = await this.repository.startSession(input.sessionId, input.expectedVersion, this.clock.now());

    if (outcome.outcome === 'not_found') return err(clinicSessionNotFoundForLifecycleError());
    if (outcome.outcome === 'invalid_transition') {
      return err(new DomainRuleViolation({ code: 'INVALID_STATUS_TRANSITION', message: 'This session has already been started.' }));
    }
    if (outcome.outcome === 'stale') {
      const current = await this.repository.findClinicSessionById(input.sessionId);
      return err(
        new ConflictError({
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else updated this a moment ago. Here is the current version — review it and try again.',
          ...(current === null ? {} : { details: { current } }),
        }),
      );
    }

    await this.auditRecorder.recordChange({
      entityType: 'scheduling.clinic_session',
      entityId: input.sessionId,
      action: 'started',
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return ok(outcome.session);
  }
}
