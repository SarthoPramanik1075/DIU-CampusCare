import type { FastifyInstance } from 'fastify';

import type { AuthorizationRouteConfig, PolicyEnforcementHandler } from '../../../../kernel/authz/policy-enforcement-point.js';
import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import { resolveOwnUserId, type GetSessionQuery } from '../../../iam/index.js';
import type { CreateDutyRosterHandler } from '../../application/create-duty-roster.handler.js';
import type { DeleteDutyRosterHandler } from '../../application/delete-duty-roster.handler.js';
import type { DutyRoster } from '../../application/duty-roster-repository.js';
import type { ListDutyRostersQuery } from '../../application/queries/list-duty-rosters.query.js';
import type { UpdateDutyRosterHandler } from '../../application/update-duty-roster.handler.js';

export interface DutyRosterRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly listDutyRosters: ListDutyRostersQuery;
  readonly createDutyRoster: CreateDutyRosterHandler;
  readonly updateDutyRoster: UpdateDutyRosterHandler;
  readonly deleteDutyRoster: DeleteDutyRosterHandler;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function dutyRosterDto(roster: DutyRoster) {
  return {
    rosterId: roster.rosterId,
    doctorId: roster.doctorId,
    weekday: roster.weekday,
    startsAtLocal: roster.startsAtLocal,
    endsAtLocal: roster.endsAtLocal,
    effectiveFrom: roster.effectiveFrom,
    effectiveTo: roster.effectiveTo,
    isActive: roster.isActive,
    version: roster.version,
  };
}

/** API §3.2 — duty roster administration, PEP-gated against `doctor-schedules-and-sessions` (matrix: ANON/STU/DOC read, MCS create/update/delete, ADM read). */
export function registerDutyRosterRoutes(app: FastifyInstance, deps: DutyRosterRouteDeps): void {
  app.get(
    '/api/v1/doctors/:id/duty-rosters',
    { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'read' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const query = request.query as { isActive?: unknown };
      const isActive = query.isActive === 'false' ? false : query.isActive === 'true' ? true : true;
      const items = await deps.listDutyRosters.execute({ doctorId: id, isActive });
      return { items: items.map(dutyRosterDto) };
    },
  );

  app.post(
    '/api/v1/doctors/:id/duty-rosters',
    { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'create' }) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as { weekday?: unknown; startsAtLocal?: unknown; endsAtLocal?: unknown; effectiveFrom?: unknown; effectiveTo?: unknown };

      if (typeof body.weekday !== 'number' || !isNonEmptyString(body.startsAtLocal) || !isNonEmptyString(body.endsAtLocal) || !isNonEmptyString(body.effectiveFrom)) {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Check the roster details and try again.',
          fields: [
            ...(typeof body.weekday === 'number' ? [] : [{ field: 'weekday', rule: 'VALIDATION_FAILED', message: 'Required' }]),
            ...(isNonEmptyString(body.startsAtLocal) ? [] : [{ field: 'startsAtLocal', rule: 'VALIDATION_FAILED', message: 'Required' }]),
            ...(isNonEmptyString(body.endsAtLocal) ? [] : [{ field: 'endsAtLocal', rule: 'VALIDATION_FAILED', message: 'Required' }]),
            ...(isNonEmptyString(body.effectiveFrom) ? [] : [{ field: 'effectiveFrom', rule: 'VALIDATION_FAILED', message: 'Required' }]),
          ],
        });
      }

      const result = await deps.createDutyRoster.execute({
        doctorId: id,
        weekday: body.weekday,
        startsAtLocal: body.startsAtLocal,
        endsAtLocal: body.endsAtLocal,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: typeof body.effectiveTo === 'string' ? body.effectiveTo : null,
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;

      reply.status(201);
      return dutyRosterDto(result.value);
    },
  );

  app.patch(
    '/api/v1/duty-rosters/:id',
    { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'update' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as Record<string, unknown>;

      if (typeof body.version !== 'number') {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Include the current version with your update.',
          fields: [{ field: 'version', rule: 'VR-92', message: 'Required' }],
        });
      }

      const result = await deps.updateDutyRoster.execute({
        rosterId: id,
        weekday: typeof body.weekday === 'number' ? body.weekday : undefined,
        startsAtLocal: typeof body.startsAtLocal === 'string' ? body.startsAtLocal : undefined,
        endsAtLocal: typeof body.endsAtLocal === 'string' ? body.endsAtLocal : undefined,
        effectiveFrom: typeof body.effectiveFrom === 'string' ? body.effectiveFrom : undefined,
        effectiveTo: 'effectiveTo' in body ? (body.effectiveTo as string | null) : undefined,
        expectedVersion: body.version,
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;
      return dutyRosterDto(result.value);
    },
  );

  app.delete(
    '/api/v1/duty-rosters/:id',
    { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'delete' }) },
    async (request, reply) => {
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

      const result = await deps.deleteDutyRoster.execute({ rosterId: id, reason: body.reason, actorId, correlationId: getCorrelationId(request) });
      if (!result.ok) throw result.error;
      reply.status(204);
    },
  );
}
