import type { FastifyInstance } from 'fastify';

import type { AuthorizationRouteConfig, PolicyEnforcementHandler } from '../../../../kernel/authz/policy-enforcement-point.js';
import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import { resolveOwnUserId, type GetSessionQuery } from '../../../iam/index.js';
import type { CancelSessionHandler } from '../../application/cancel-session.handler.js';
import type { ClinicSessionListItem } from '../../application/clinic-session-repository.js';
import type { CompleteSessionHandler } from '../../application/complete-session.handler.js';
import type { CreateClinicSessionHandler } from '../../application/create-clinic-session.handler.js';
import type { InterruptSessionHandler } from '../../application/interrupt-session.handler.js';
import type { ClinicSessionDetail, GetClinicSessionQuery } from '../../application/queries/get-clinic-session.query.js';
import type { GetSessionSlotsQuery } from '../../application/queries/get-session-slots.query.js';
import type { ListClinicSessionsQuery } from '../../application/queries/list-clinic-sessions.query.js';
import type { StartSessionHandler } from '../../application/start-session.handler.js';
import type { UpdateClinicSessionHandler } from '../../application/update-clinic-session.handler.js';

export interface ClinicSessionRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly listClinicSessions: ListClinicSessionsQuery;
  readonly getClinicSession: GetClinicSessionQuery;
  readonly createClinicSession: CreateClinicSessionHandler;
  readonly updateClinicSession: UpdateClinicSessionHandler;
  readonly getSessionSlots: GetSessionSlotsQuery;
  readonly startSession: StartSessionHandler;
  readonly interruptSession: InterruptSessionHandler;
  readonly completeSession: CompleteSessionHandler;
  readonly cancelSession: CancelSessionHandler;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sessionDto(session: ClinicSessionListItem) {
  return {
    sessionId: session.sessionId,
    doctorId: session.doctorId,
    doctorName: session.doctorName,
    sessionDate: session.sessionDate,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    slotLengthMinutes: session.slotLengthMinutes,
    walkInAllocationPct: session.walkInAllocationPct,
    totalSlotCount: session.totalSlotCount,
    bookableSlotCount: session.bookableSlotCount,
    bookedSlotCount: session.bookedSlotCount,
    status: session.status,
    actuallyStartedAt: session.actuallyStartedAt,
    actuallyEndedAt: session.actuallyEndedAt,
    isOverride: session.isOverride,
    version: session.version,
  };
}

function sessionDetailDto(session: ClinicSessionDetail) {
  return { ...sessionDto(session), nextSerial: session.nextSerial, changeReason: session.changeReason, queueSummary: session.queueSummary };
}

function toDateOrUndefined(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** API §3.3 — clinic-session administration, PEP-gated against `doctor-schedules-and-sessions` (matrix: ANON/STU/DOC read, MCS create/update, ADM read). */
export function registerClinicSessionRoutes(app: FastifyInstance, deps: ClinicSessionRouteDeps): void {
  app.get('/api/v1/sessions', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'read' }) }, async (request) => {
    const query = request.query as { from?: unknown; to?: unknown; doctorId?: unknown; status?: unknown };
    const from = isNonEmptyString(query.from) ? query.from : todayIsoDate();
    const to = isNonEmptyString(query.to) ? query.to : from;

    const result = await deps.listClinicSessions.execute({
      from,
      to,
      ...(isNonEmptyString(query.doctorId) ? { doctorId: query.doctorId } : {}),
      ...(isNonEmptyString(query.status) ? { status: query.status as never } : {}),
    });
    if (!result.ok) throw result.error;
    return { items: result.value.map(sessionDto), nextCursor: null };
  });

  app.post('/api/v1/sessions', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'create' }) }, async (request, reply) => {
    const actorId = await resolveOwnUserId(request, deps.getSession);
    const body = request.body as {
      doctorId?: unknown;
      sessionDate?: unknown;
      startsAt?: unknown;
      endsAt?: unknown;
      slotLengthMinutes?: unknown;
      walkInAllocationPct?: unknown;
      dutyRosterId?: unknown;
      changeReason?: unknown;
      overrideNonServiceDay?: unknown;
    };

    const startsAt = toDateOrUndefined(body.startsAt);
    const endsAt = toDateOrUndefined(body.endsAt);
    if (!isNonEmptyString(body.doctorId) || !isNonEmptyString(body.sessionDate) || startsAt === undefined || endsAt === undefined) {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Check the session details and try again.',
        fields: [
          ...(isNonEmptyString(body.doctorId) ? [] : [{ field: 'doctorId', rule: 'VALIDATION_FAILED', message: 'Required' }]),
          ...(isNonEmptyString(body.sessionDate) ? [] : [{ field: 'sessionDate', rule: 'VALIDATION_FAILED', message: 'Required' }]),
          ...(startsAt === undefined ? [{ field: 'startsAt', rule: 'VALIDATION_FAILED', message: 'Required, valid timestamp' }] : []),
          ...(endsAt === undefined ? [{ field: 'endsAt', rule: 'VALIDATION_FAILED', message: 'Required, valid timestamp' }] : []),
        ],
      });
    }

    const result = await deps.createClinicSession.execute({
      doctorId: body.doctorId,
      dutyRosterId: isNonEmptyString(body.dutyRosterId) ? body.dutyRosterId : null,
      sessionDate: body.sessionDate,
      startsAt,
      endsAt,
      slotLengthMinutes: typeof body.slotLengthMinutes === 'number' ? body.slotLengthMinutes : undefined,
      walkInAllocationPct: typeof body.walkInAllocationPct === 'number' ? body.walkInAllocationPct : undefined,
      changeReason: typeof body.changeReason === 'string' ? body.changeReason : null,
      overrideNonServiceDay: body.overrideNonServiceDay === true,
      actorId,
      correlationId: getCorrelationId(request),
    });
    if (!result.ok) throw result.error;

    reply.status(201);
    return sessionDto(result.value);
  });

  app.get('/api/v1/sessions/:id', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'read' }) }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await deps.getClinicSession.execute(id);
    if (!result.ok) throw result.error;
    return sessionDetailDto(result.value);
  });

  app.patch('/api/v1/sessions/:id', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'update' }) }, async (request) => {
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

    const result = await deps.updateClinicSession.execute({
      sessionId: id,
      startsAt: toDateOrUndefined(body.startsAt),
      endsAt: toDateOrUndefined(body.endsAt),
      slotLengthMinutes: typeof body.slotLengthMinutes === 'number' ? body.slotLengthMinutes : undefined,
      walkInAllocationPct: typeof body.walkInAllocationPct === 'number' ? body.walkInAllocationPct : undefined,
      changeReason: typeof body.changeReason === 'string' ? body.changeReason : undefined,
      expectedVersion: body.version,
      actorId,
      correlationId: getCorrelationId(request),
    });
    if (!result.ok) throw result.error;
    return sessionDto(result.value);
  });

  app.get('/api/v1/sessions/:id/slots', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'read' }) }, async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { availableOnly?: unknown };
    const result = await deps.getSessionSlots.execute(id, query.availableOnly === 'true');
    if (!result.ok) throw result.error;
    return result.value;
  });

  function requireVersion(body: Record<string, unknown>): number {
    if (typeof body.version !== 'number') {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Include the current version with your request.',
        fields: [{ field: 'version', rule: 'VR-92', message: 'Required' }],
      });
    }
    return body.version;
  }

  function requireReason(body: Record<string, unknown>): string {
    if (!isNonEmptyString(body.reason)) {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Enter a reason of at least 10 characters.',
        fields: [{ field: 'reason', rule: 'VR-93', message: 'Required' }],
      });
    }
    return body.reason;
  }

  app.post('/api/v1/sessions/:id/start', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'update' }) }, async (request) => {
    const { id } = request.params as { id: string };
    const actorId = await resolveOwnUserId(request, deps.getSession);
    const body = request.body as Record<string, unknown>;
    const result = await deps.startSession.execute({ sessionId: id, expectedVersion: requireVersion(body), actorId, correlationId: getCorrelationId(request) });
    if (!result.ok) throw result.error;
    return sessionDto(result.value);
  });

  app.post('/api/v1/sessions/:id/interrupt', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'update' }) }, async (request) => {
    const { id } = request.params as { id: string };
    const actorId = await resolveOwnUserId(request, deps.getSession);
    const body = request.body as Record<string, unknown>;
    const result = await deps.interruptSession.execute({ sessionId: id, reason: requireReason(body), expectedVersion: requireVersion(body), actorId, correlationId: getCorrelationId(request) });
    if (!result.ok) throw result.error;
    return result.value;
  });

  app.post('/api/v1/sessions/:id/complete', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'update' }) }, async (request) => {
    const { id } = request.params as { id: string };
    const actorId = await resolveOwnUserId(request, deps.getSession);
    const body = request.body as Record<string, unknown>;
    const result = await deps.completeSession.execute({ sessionId: id, expectedVersion: requireVersion(body), actorId, correlationId: getCorrelationId(request) });
    if (!result.ok) throw result.error;
    return result.value;
  });

  app.post('/api/v1/sessions/:id/cancel', { preHandler: deps.pep({ resource: 'doctor-schedules-and-sessions', action: 'update' }) }, async (request) => {
    const { id } = request.params as { id: string };
    const actorId = await resolveOwnUserId(request, deps.getSession);
    const body = request.body as Record<string, unknown>;
    const result = await deps.cancelSession.execute({
      sessionId: id,
      reason: requireReason(body),
      confirmedImpact: body.confirmedImpact === true,
      expectedVersion: requireVersion(body),
      actorId,
      correlationId: getCorrelationId(request),
    });
    if (!result.ok) throw result.error;
    return result.value;
  });
}
