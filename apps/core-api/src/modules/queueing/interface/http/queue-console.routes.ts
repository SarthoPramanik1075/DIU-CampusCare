import type { RoleCode } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';

import { AuthorizationError, ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import { SESSION_COOKIE_NAME, unauthenticatedError, type GetSessionQuery } from '../../../iam/index.js';
import type { QueueConsoleRowWithActions, QueueConsoleSession, GetQueueConsoleQuery  } from '../../application/queries/get-queue-console.query.js';
import type { SessionQueueResult, SessionQueueViewerRole, GetSessionQueueQuery  } from '../../application/queries/get-session-queue.query.js';

export interface QueueConsoleRouteDeps {
  readonly getSession: GetSessionQuery;
  readonly getQueueConsole: GetQueueConsoleQuery;
  readonly getSessionQueue: GetSessionQueueQuery;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function forbiddenError(): AuthorizationError {
  return new AuthorizationError({ code: 'FORBIDDEN', message: 'You do not have permission to do that.', httpStatus: 403 });
}

function sessionNotFoundError(): AuthorizationError {
  return new AuthorizationError({ code: 'NOT_FOUND', message: 'That session could not be found.', httpStatus: 404 });
}

function queueRowDto(row: QueueConsoleRowWithActions) {
  return {
    appointmentId: row.appointmentId,
    appointmentRef: row.appointmentRef,
    serialNumber: row.serialNumber,
    isEmergency: row.isEmergency,
    status: row.status,
    origin: row.origin,
    studentRef: row.studentRef,
    studentName: row.studentName,
    unregisteredName: row.unregisteredName,
    currentEstimate: row.currentEstimate?.toISOString() ?? null,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    paymentStatus: row.paymentStatus,
    exceededWalkinAllocation: row.exceededWalkinAllocation,
    enteredRetrospectively: row.enteredRetrospectively,
    permittedTransitions: row.permittedTransitions,
    version: row.version,
  };
}

function consoleSessionDto(session: QueueConsoleSession) {
  return {
    sessionId: session.sessionId,
    doctorId: session.doctorId,
    doctorName: session.doctorName,
    sessionStatus: session.sessionStatus,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    nowServingSerial: session.nowServingSerial,
    walkInAllocationExceeded: session.walkInAllocationExceeded,
    counts: session.counts,
    queue: session.queue.map(queueRowDto),
  };
}

function sessionQueueDto(result: SessionQueueResult) {
  return {
    sessionId: result.sessionId,
    doctorId: result.doctorId,
    doctorName: result.doctorName,
    sessionStatus: result.sessionStatus,
    nowServingSerial: result.nowServingSerial,
    walkInAllocationExceeded: result.walkInAllocationExceeded,
    counts: result.counts,
    queue: result.queue === null ? null : result.queue.map(queueRowDto),
  };
}

const SESSION_QUEUE_VIEWER_ROLES: readonly SessionQueueViewerRole[] = ['MCS', 'DOC', 'ADM'];

function isSessionQueueViewerRole(role: RoleCode): role is SessionQueueViewerRole {
  return (SESSION_QUEUE_VIEWER_ROLES as readonly string[]).includes(role);
}

/**
 * API §4.2 — the staff queue console's backend (F-01, M3-T06/T17).
 * `live-queue`'s matrix grant is shared by ANON (the public kiosk, a
 * different, redacted endpoint entirely — M3-J), STU (their own single
 * position, already served by `GET /appointments/{id}/queue-position`),
 * DOC (their own session) and MCS (any) — one PEP call against that
 * resource can't express "MCS gets the real console, nobody else does"
 * without also admitting ANON, so both routes here resolve the session
 * directly and check the role explicitly, the same precedent
 * `appointment.routes.ts`'s detail/cancel endpoints already established.
 */
export function registerQueueConsoleRoutes(app: FastifyInstance, deps: QueueConsoleRouteDeps): void {
  app.get('/api/v1/queue/console', async (request) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    const session = sessionId === undefined ? null : await deps.getSession.execute(sessionId);
    if (session === null) throw unauthenticatedError();
    if (!session.roles.includes('MCS')) throw forbiddenError();

    const query = request.query as { date?: unknown; doctorId?: unknown };
    if (!isNonEmptyString(query.date)) {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Provide a date.',
        fields: [{ field: 'date', rule: 'API §4.2', message: 'Required' }],
      });
    }

    const result = await deps.getQueueConsole.execute(query.date, isNonEmptyString(query.doctorId) ? query.doctorId : undefined, session.userId, getCorrelationId(request));
    if (!result.ok) throw result.error;

    return { sessions: result.value.map(consoleSessionDto) };
  });

  app.get('/api/v1/sessions/:id/queue', async (request) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    const session = sessionId === undefined ? null : await deps.getSession.execute(sessionId);
    if (session === null) throw unauthenticatedError();

    const viewerRole = session.roles.find(isSessionQueueViewerRole);
    if (viewerRole === undefined) throw forbiddenError();

    const { id } = request.params as { id: string };
    const result = await deps.getSessionQueue.execute(id, { role: viewerRole, userId: session.userId }, getCorrelationId(request));
    if (result === null) throw sessionNotFoundError();

    return sessionQueueDto(result);
  });
}
