import type { FastifyInstance } from 'fastify';

import type { AuthorizationRouteConfig, PolicyEnforcementHandler } from '../../../../kernel/authz/policy-enforcement-point.js';
import { AuthorizationError, ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import { resolveOwnUserId, type GetSessionQuery } from '../../../iam/index.js';
import type { ConfirmUnavailabilityHandler } from '../../application/confirm-unavailability.handler.js';
import type { DeleteUnavailabilityHandler } from '../../application/delete-unavailability.handler.js';
import type { PreviewUnavailabilityHandler } from '../../application/preview-unavailability.handler.js';
import type { ListUnavailabilityQuery } from '../../application/queries/list-unavailability.query.js';
import type { UnavailabilityRepository } from '../../application/unavailability-repository.js';

export interface UnavailabilityRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly listUnavailability: ListUnavailabilityQuery;
  readonly previewUnavailability: PreviewUnavailabilityHandler;
  readonly confirmUnavailability: ConfirmUnavailabilityHandler;
  readonly deleteUnavailability: DeleteUnavailabilityHandler;
  readonly unavailabilityRepository: Pick<UnavailabilityRepository, 'doctorExists'>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const DEFAULT_WINDOW_DAYS = 90;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultToDate(from: string): string {
  return new Date(new Date(`${from}T00:00:00Z`).getTime() + DEFAULT_WINDOW_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
}

/** API §3.4 — the two-step doctor-unavailability flow, PEP-gated against `doctor-schedules-and-sessions` (matrix: read for everyone, MCS alone has create/delete — which is what actually keeps the two writing endpoints staff-only). */
export function registerUnavailabilityRoutes(app: FastifyInstance, deps: UnavailabilityRouteDeps): void {
  app.get('/api/v1/doctors/:id/unavailability', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'read' }) }, async (request) => {
    const { id } = request.params as { id: string };
    if (!(await deps.unavailabilityRepository.doctorExists(id))) {
      throw new AuthorizationError({ code: 'NOT_FOUND', message: 'That doctor could not be found.', httpStatus: 404 });
    }

    const query = request.query as { from?: unknown; to?: unknown };
    const from = isNonEmptyString(query.from) ? query.from : todayIsoDate();
    const to = isNonEmptyString(query.to) ? query.to : defaultToDate(from);

    const result = await deps.listUnavailability.execute(id, from, to);
    if (!result.ok) throw result.error;
    return {
      items: result.value.map((record) => ({
        unavailabilityId: record.unavailabilityId,
        startDate: record.startDate,
        endDate: record.endDate,
        reason: record.reason,
        createdBy: record.createdBy,
        createdAt: record.createdAt,
      })),
    };
  });

  app.post('/api/v1/doctors/:id/unavailability/impact-preview', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'create' }) }, async (request) => {
    const { id } = request.params as { id: string };
    const actorId = await resolveOwnUserId(request, deps.getSession);
    const body = request.body as { startDate?: unknown; endDate?: unknown; reason?: unknown };

    if (!isNonEmptyString(body.startDate) || !isNonEmptyString(body.endDate) || !isNonEmptyString(body.reason)) {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Check the leave details and try again.',
        fields: [
          ...(isNonEmptyString(body.startDate) ? [] : [{ field: 'startDate', rule: 'VALIDATION_FAILED', message: 'Required' }]),
          ...(isNonEmptyString(body.endDate) ? [] : [{ field: 'endDate', rule: 'VALIDATION_FAILED', message: 'Required' }]),
          ...(isNonEmptyString(body.reason) ? [] : [{ field: 'reason', rule: 'VR-93', message: 'Required' }]),
        ],
      });
    }

    const result = await deps.previewUnavailability.execute({ doctorId: id, startDate: body.startDate, endDate: body.endDate, reason: body.reason, actorId, correlationId: getCorrelationId(request) });
    if (!result.ok) throw result.error;
    return result.value;
  });

  app.post('/api/v1/doctors/:id/unavailability', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'create' }) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const actorId = await resolveOwnUserId(request, deps.getSession);
    const body = request.body as { previewToken?: unknown; startDate?: unknown; endDate?: unknown; reason?: unknown };

    if (!isNonEmptyString(body.previewToken) || !isNonEmptyString(body.startDate) || !isNonEmptyString(body.endDate) || !isNonEmptyString(body.reason)) {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Check the leave details and try again.',
        fields: [
          ...(isNonEmptyString(body.previewToken) ? [] : [{ field: 'previewToken', rule: 'VALIDATION_FAILED', message: 'Required' }]),
          ...(isNonEmptyString(body.startDate) ? [] : [{ field: 'startDate', rule: 'VALIDATION_FAILED', message: 'Required' }]),
          ...(isNonEmptyString(body.endDate) ? [] : [{ field: 'endDate', rule: 'VALIDATION_FAILED', message: 'Required' }]),
          ...(isNonEmptyString(body.reason) ? [] : [{ field: 'reason', rule: 'VR-93', message: 'Required' }]),
        ],
      });
    }

    const result = await deps.confirmUnavailability.execute({
      doctorId: id,
      previewToken: body.previewToken,
      startDate: body.startDate,
      endDate: body.endDate,
      reason: body.reason,
      actorId,
      correlationId: getCorrelationId(request),
    });
    if (!result.ok) throw result.error;

    reply.status(201);
    return result.value;
  });

  app.delete('/api/v1/unavailability/:id', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'delete' }) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const actorId = await resolveOwnUserId(request, deps.getSession);
    const body = request.body as { reason?: unknown };

    if (!isNonEmptyString(body.reason)) {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Enter a reason of at least 10 characters.',
        fields: [{ field: 'reason', rule: 'VR-93', message: 'Required' }],
      });
    }

    const result = await deps.deleteUnavailability.execute({ unavailabilityId: id, reason: body.reason, actorId, correlationId: getCorrelationId(request) });
    if (!result.ok) throw result.error;
    reply.status(204);
  });
}
