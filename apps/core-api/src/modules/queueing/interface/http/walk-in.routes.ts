import type { FastifyInstance } from 'fastify';

import type { AuthorizationRouteConfig, PolicyEnforcementHandler } from '../../../../kernel/authz/policy-enforcement-point.js';
import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import { getIdempotencyKey } from '../../../../kernel/http/idempotency.js';
import { resolveOwnUserId, type GetSessionQuery } from '../../../iam/index.js';
import type { RegisterWalkInHandler, RegisterWalkInResult } from '../../application/register-walk-in.handler.js';

export interface WalkInRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly registerWalkIn: RegisterWalkInHandler;
}

/** FR-APT-07/08 — mandatory, never omitted: an estimate is never presented as a guarantee. */
const ESTIMATE_DISCLAIMER = 'This is an estimate, not a guaranteed time.';

const ALLOCATION_EXCEEDED_NOTE =
  'The walk-in allocation for this session is full. This patient has been added anyway and the console shows the allocation was exceeded.';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function walkInDto(result: RegisterWalkInResult) {
  return {
    appointmentId: result.appointment.appointmentId,
    appointmentRef: result.appointment.appointmentRef,
    serialNumber: result.appointment.serialNumber,
    origin: 'walk_in' as const,
    status: result.appointment.status,
    position: result.position,
    currentEstimate: result.appointment.currentEstimate?.toISOString() ?? null,
    estimateDisclaimer: ESTIMATE_DISCLAIMER,
    exceededWalkinAllocation: result.appointment.exceededWalkinAllocation,
    allocationNote: result.appointment.exceededWalkinAllocation ? ALLOCATION_EXCEEDED_NOTE : null,
    suspensionIgnored: result.suspensionIgnored,
    enteredRetrospectively: false,
    version: result.appointment.version,
  };
}

/** API §4.4 — `POST /api/v1/walk-ins` (M3-T12/T13, M3-I). MCS-only, scope `any` — a plain `pep()` call, no two-resource bypass needed. */
export function registerWalkInRoutes(app: FastifyInstance, deps: WalkInRouteDeps): void {
  app.post(
    '/api/v1/walk-ins',
    { preHandler: deps.pep({ resource: 'walk-in-registration', action: 'create' }) },
    async (request, reply) => {
      const body = request.body as {
        clinicSessionId?: unknown;
        studentRef?: unknown;
        unregisteredName?: unknown;
        visitReasonCategoryId?: unknown;
        isEmergency?: unknown;
        emergencyReason?: unknown;
      };

      if (!isNonEmptyString(body.clinicSessionId)) {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Choose a session to add this patient to.',
          fields: [{ field: 'clinicSessionId', rule: 'API §4.4', message: 'Required' }],
        });
      }

      const actorId = await resolveOwnUserId(request, deps.getSession);

      const result = await deps.registerWalkIn.execute({
        clinicSessionId: body.clinicSessionId,
        studentRef: isNonEmptyString(body.studentRef) ? body.studentRef : null,
        unregisteredName: isNonEmptyString(body.unregisteredName) ? body.unregisteredName : null,
        visitReasonCategoryId: isNonEmptyString(body.visitReasonCategoryId) ? body.visitReasonCategoryId : null,
        isEmergency: body.isEmergency === true,
        emergencyReason: isNonEmptyString(body.emergencyReason) ? body.emergencyReason : null,
        idempotencyKey: getIdempotencyKey(request),
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;

      reply.status(201);
      return walkInDto(result.value);
    },
  );
}
