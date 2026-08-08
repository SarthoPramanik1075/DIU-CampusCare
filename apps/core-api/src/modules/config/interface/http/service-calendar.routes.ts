import type { FastifyInstance } from 'fastify';

import type { AuthorizationRouteConfig, PolicyEnforcementHandler } from '../../../../kernel/authz/policy-enforcement-point.js';
import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import { resolveOwnUserId, type GetSessionQuery } from '../../../iam/index.js';
import type { CreateServiceCalendarEntriesHandler } from '../../application/create-service-calendar-entries.handler.js';
import type { DeleteServiceCalendarEntryHandler } from '../../application/delete-service-calendar-entry.handler.js';
import type { GetPublicServiceCalendarQuery } from '../../application/queries/get-public-service-calendar.query.js';
import type { ListServiceCalendarQuery } from '../../application/queries/list-service-calendar.query.js';
import type { UpdateServiceCalendarEntryHandler } from '../../application/update-service-calendar-entry.handler.js';
import type { ServiceCalendarEntry } from '../../domain/service-calendar.js';

export interface ServiceCalendarRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly listServiceCalendar: ListServiceCalendarQuery;
  readonly getPublicServiceCalendar: GetPublicServiceCalendarQuery;
  readonly createServiceCalendarEntries: CreateServiceCalendarEntriesHandler;
  readonly updateServiceCalendarEntry: UpdateServiceCalendarEntryHandler;
  readonly deleteServiceCalendarEntry: DeleteServiceCalendarEntryHandler;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function adminEntryDto(entry: ServiceCalendarEntry) {
  return {
    id: entry.id,
    date: entry.calendarDate,
    isServiceDay: entry.isServiceDay,
    reason: entry.reason,
    createdBy: { userId: entry.createdBy, fullName: entry.createdByName },
    createdAt: entry.createdAt,
    version: entry.version,
  };
}

function publicEntryDto(entry: ServiceCalendarEntry) {
  return { date: entry.calendarDate, isServiceDay: entry.isServiceDay, reason: entry.reason };
}

/** API §2.6 (public read) and §8.4–8.6 (ADM administration) for the non-service calendar. */
export function registerServiceCalendarRoutes(app: FastifyInstance, deps: ServiceCalendarRouteDeps): void {
  app.get('/api/v1/public/service-calendar', { preHandler: deps.pep({ resource: 'non-service-calendar', action: 'read' }) }, async (request, reply) => {
    const query = request.query as { from?: unknown; to?: unknown };
    const from = isNonEmptyString(query.from) ? query.from : todayIsoDate();
    const to = isNonEmptyString(query.to) ? query.to : new Date(new Date(`${from}T00:00:00Z`).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = await deps.getPublicServiceCalendar.execute(from, to);
    if (!result.ok) throw result.error;
    reply.header('Cache-Control', 'public, max-age=60');
    return { items: result.value.map(publicEntryDto) };
  });

  app.get('/api/v1/service-calendar', { preHandler: deps.pep({ resource: 'non-service-calendar', action: 'read' }) }, async (request) => {
    const query = request.query as { from?: unknown; to?: unknown };
    const from = isNonEmptyString(query.from) ? query.from : todayIsoDate();
    const to = isNonEmptyString(query.to) ? query.to : new Date(new Date(`${from}T00:00:00Z`).getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = await deps.listServiceCalendar.execute(from, to);
    if (!result.ok) throw result.error;
    return { items: result.value.map(adminEntryDto) };
  });

  app.post('/api/v1/service-calendar', { preHandler: deps.pep({ resource: 'non-service-calendar', action: 'create' }) }, async (request, reply) => {
    const actorId = await resolveOwnUserId(request, deps.getSession);
    const body = request.body as { fromDate?: unknown; toDate?: unknown; isServiceDay?: unknown; reason?: unknown };

    if (!isNonEmptyString(body.fromDate) || !isNonEmptyString(body.reason)) {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Check the calendar entry and try again.',
        fields: [
          ...(isNonEmptyString(body.fromDate) ? [] : [{ field: 'fromDate', rule: 'VALIDATION_FAILED', message: 'Required' }]),
          ...(isNonEmptyString(body.reason) ? [] : [{ field: 'reason', rule: 'API §8.4', message: 'Required' }]),
        ],
      });
    }

    const result = await deps.createServiceCalendarEntries.execute({
      fromDate: body.fromDate,
      toDate: isNonEmptyString(body.toDate) ? body.toDate : body.fromDate,
      isServiceDay: body.isServiceDay === true,
      reason: body.reason,
      actorId,
      correlationId: getCorrelationId(request),
    });
    if (!result.ok) throw result.error;

    reply.status(201);
    return { created: result.value.created, items: result.value.items.map(adminEntryDto), conflictingSessions: result.value.conflictingSessions };
  });

  app.patch('/api/v1/service-calendar/:id', { preHandler: deps.pep({ resource: 'non-service-calendar', action: 'update' }) }, async (request) => {
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

    const result = await deps.updateServiceCalendarEntry.execute({
      entryId: id,
      isServiceDay: typeof body.isServiceDay === 'boolean' ? body.isServiceDay : undefined,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      expectedVersion: body.version,
      actorId,
      correlationId: getCorrelationId(request),
    });
    if (!result.ok) throw result.error;
    return adminEntryDto(result.value);
  });

  app.delete('/api/v1/service-calendar/:id', { preHandler: deps.pep({ resource: 'non-service-calendar', action: 'delete' }) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const actorId = await resolveOwnUserId(request, deps.getSession);

    const result = await deps.deleteServiceCalendarEntry.execute({ entryId: id, actorId, correlationId: getCorrelationId(request) });
    if (!result.ok) throw result.error;
    reply.status(204);
  });
}
