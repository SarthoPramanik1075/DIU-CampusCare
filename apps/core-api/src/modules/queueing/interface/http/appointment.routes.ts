import type { RoleCode } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';

import type { AuthorizationRouteConfig, PolicyEnforcementHandler } from '../../../../kernel/authz/policy-enforcement-point.js';
import { AuthorizationError, ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import { resolveOwnUserId, SESSION_COOKIE_NAME, unauthenticatedError, type GetSessionQuery } from '../../../iam/index.js';
import type { AppointmentDetail, AppointmentListScope, BookedAppointment, CancelledAppointment, MyAppointmentListItem } from '../../application/appointment-repository.js';
import type { BookAppointmentHandler } from '../../application/book-appointment.handler.js';
import { appointmentNotFoundError, type CancelAppointmentHandler } from '../../application/cancel-appointment.handler.js';
import type { AppointmentViewerRole, GetAppointmentDetailQuery } from '../../application/queries/get-appointment-detail.query.js';
import type { AvailabilitySessionItem, GetAvailabilityQuery } from '../../application/queries/get-availability.query.js';
import type { GetQueuePositionQuery } from '../../application/queries/get-queue-position.query.js';
import type { ListMyAppointmentsQuery } from '../../application/queries/list-my-appointments.query.js';
import { canCancel } from '../../domain/appointment-status.js';

export interface AppointmentRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly getAvailability: GetAvailabilityQuery;
  readonly bookAppointment: BookAppointmentHandler;
  readonly listMyAppointments: ListMyAppointmentsQuery;
  readonly getAppointmentDetail: GetAppointmentDetailQuery;
  readonly cancelAppointment: CancelAppointmentHandler;
  readonly getQueuePosition: GetQueuePositionQuery;
}

const DETAIL_VIEWER_ROLES: readonly AppointmentViewerRole[] = ['STU', 'DOC', 'MCS', 'ADM'];

function isDetailViewerRole(role: RoleCode): role is AppointmentViewerRole {
  return (DETAIL_VIEWER_ROLES as readonly string[]).includes(role);
}

function forbiddenError(): AuthorizationError {
  return new AuthorizationError({ code: 'FORBIDDEN', message: 'You do not have permission to do that.', httpStatus: 403 });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function availabilityItemDto(item: AvailabilitySessionItem) {
  return {
    sessionId: item.sessionId,
    doctorId: item.doctorId,
    doctorName: item.doctorName,
    sessionDate: item.sessionDate,
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    bookableSlotCount: item.bookableSlotCount,
    bookedSlotCount: item.bookedSlotCount,
    remainingSlotCount: item.remainingSlotCount,
    bookingBlocked: item.bookingBlocked,
    studentAlreadyBooked: item.studentAlreadyBooked,
  };
}

/** FR-APT-07/08 — mandatory, never omitted: a booked time is an estimate, never a guarantee. */
const ESTIMATE_DISCLAIMER = 'This is an estimated time, not a guaranteed appointment time.';

function bookedAppointmentDto(appointment: BookedAppointment) {
  return {
    appointmentId: appointment.appointmentId,
    appointmentRef: appointment.appointmentRef,
    clinicSessionId: appointment.clinicSessionId,
    doctorId: appointment.doctorId,
    doctorName: appointment.doctorName,
    sessionDate: appointment.sessionDate,
    serialNumber: appointment.serialNumber,
    status: appointment.status,
    estimateAtBooking: appointment.estimateAtBooking.toISOString(),
    estimateDisclaimer: ESTIMATE_DISCLAIMER,
    paymentStatus: appointment.paymentStatus,
    paymentNote: 'Pay at the counter when you check in.',
    version: appointment.version,
  };
}

function myAppointmentItemDto(item: MyAppointmentListItem) {
  return {
    appointmentId: item.appointmentId,
    appointmentRef: item.appointmentRef,
    doctorId: item.doctorId,
    doctorName: item.doctorName,
    sessionDate: item.sessionDate,
    serialNumber: item.serialNumber,
    status: item.status,
    currentEstimate: item.currentEstimate?.toISOString() ?? null,
    canCancel: canCancel(item.status),
  };
}

/** ADM's grant carries "metadata only" (PRM-09) — no student identity, no reason-for-visit. Every other viewer sees the full record. */
function appointmentDetailDto(detail: AppointmentDetail, viewerRole: AppointmentViewerRole) {
  const metadataOnly = viewerRole === 'ADM';
  return {
    appointmentId: detail.appointmentId,
    appointmentRef: detail.appointmentRef,
    clinicSessionId: detail.clinicSessionId,
    doctorId: detail.doctorId,
    doctorName: detail.doctorName,
    sessionDate: detail.sessionDate,
    sessionStatus: detail.sessionStatus,
    ...(metadataOnly ? {} : { studentRef: detail.studentRef, studentName: detail.studentName, unregisteredName: detail.unregisteredName }),
    serialNumber: detail.serialNumber,
    origin: detail.origin,
    status: detail.status,
    isEmergency: detail.isEmergency,
    ...(metadataOnly ? {} : { visitReasonNote: detail.visitReasonNote }),
    estimateAtBooking: detail.estimateAtBooking?.toISOString() ?? null,
    currentEstimate: detail.currentEstimate?.toISOString() ?? null,
    paymentStatus: detail.paymentStatus,
    checkedInAt: detail.checkedInAt?.toISOString() ?? null,
    consultationStartedAt: detail.consultationStartedAt?.toISOString() ?? null,
    consultationCompletedAt: detail.consultationCompletedAt?.toISOString() ?? null,
    cancelledAt: detail.cancelledAt?.toISOString() ?? null,
    cancellationReason: detail.cancellationReason,
    version: detail.version,
  };
}

function cancelledAppointmentDto(appointment: CancelledAppointment) {
  return {
    appointmentId: appointment.appointmentId,
    status: appointment.status,
    cancelledAt: appointment.cancelledAt.toISOString(),
    penaltyApplied: false,
    version: appointment.version,
  };
}

/** API §4.1 — booking-facing reads and the booking write itself (M3-T01/T02/T03). */
export function registerAppointmentRoutes(app: FastifyInstance, deps: AppointmentRouteDeps): void {
  app.get('/api/v1/availability', async (request) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    const session = sessionId === undefined ? null : await deps.getSession.execute(sessionId);
    const studentId = session?.roles.includes('STU') === true ? session.userId : null;

    const query = request.query as { from?: unknown; to?: unknown; doctorId?: unknown };
    if (!isNonEmptyString(query.from) || !isNonEmptyString(query.to)) {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Provide a from and to date.',
        fields: [{ field: 'from', rule: 'API §4.1', message: 'Required' }],
      });
    }

    const result = await deps.getAvailability.execute(studentId, {
      from: query.from,
      to: query.to,
      ...(isNonEmptyString(query.doctorId) ? { doctorId: query.doctorId } : {}),
    });
    if (!result.ok) throw result.error;
    return { items: result.value.map(availabilityItemDto) };
  });

  app.post(
    '/api/v1/appointments',
    { preHandler: deps.pep({ resource: 'appointment-own', action: 'create', isOwner: () => () => true }) },
    async (request, reply) => {
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as { sessionSlotId?: unknown; visitReasonCategoryId?: unknown; visitReasonNote?: unknown };

      if (!isNonEmptyString(body.sessionSlotId)) {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Choose a slot to book.',
          fields: [{ field: 'sessionSlotId', rule: 'VR-20', message: 'Required' }],
        });
      }

      const result = await deps.bookAppointment.execute({
        studentId: actorId,
        sessionSlotId: body.sessionSlotId,
        visitReasonCategoryId: isNonEmptyString(body.visitReasonCategoryId) ? body.visitReasonCategoryId : null,
        visitReasonNote: typeof body.visitReasonNote === 'string' ? body.visitReasonNote : null,
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;

      reply.status(201);
      return bookedAppointmentDto(result.value);
    },
  );

  app.get(
    '/api/v1/me/appointments',
    { preHandler: deps.pep({ resource: 'appointment-own', action: 'read', isOwner: () => () => true }) },
    async (request) => {
      const studentId = await resolveOwnUserId(request, deps.getSession);
      const query = request.query as { scope?: unknown; limit?: unknown };
      const scope: AppointmentListScope = query.scope === 'past' ? 'past' : query.scope === 'all' ? 'all' : 'upcoming';
      const limit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : undefined;

      const items = await deps.listMyAppointments.execute(studentId, scope, limit);
      return { items: items.map(myAppointmentItemDto) };
    },
  );

  app.get('/api/v1/appointments/:id', async (request) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    const session = sessionId === undefined ? null : await deps.getSession.execute(sessionId);
    if (session === null) throw unauthenticatedError();

    const viewerRole = session.roles.find(isDetailViewerRole);
    if (viewerRole === undefined) throw forbiddenError();

    const { id } = request.params as { id: string };
    const detail = await deps.getAppointmentDetail.execute(id, { role: viewerRole, userId: session.userId });
    if (detail === null) throw appointmentNotFoundError();

    return appointmentDetailDto(detail, viewerRole);
  });

  app.post('/api/v1/appointments/:id/cancel', async (request) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    const session = sessionId === undefined ? null : await deps.getSession.execute(sessionId);
    if (session === null) throw unauthenticatedError();

    const requesterRole = session.roles.includes('MCS') ? 'MCS' : session.roles.includes('STU') ? 'STU' : null;
    if (requesterRole === null) throw forbiddenError();

    const { id } = request.params as { id: string };
    const body = request.body as { reason?: unknown; version?: unknown };
    if (typeof body.version !== 'number') {
      throw new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Include the current version.',
        fields: [{ field: 'version', rule: 'VR-92', message: 'Required' }],
      });
    }

    const result = await deps.cancelAppointment.execute({
      appointmentId: id,
      requesterId: session.userId,
      requesterRole,
      reason: typeof body.reason === 'string' ? body.reason : null,
      expectedVersion: body.version,
      actorId: session.userId,
      correlationId: getCorrelationId(request),
    });
    if (!result.ok) throw result.error;

    return cancelledAppointmentDto(result.value);
  });

  app.get(
    '/api/v1/appointments/:id/queue-position',
    { preHandler: deps.pep({ resource: 'appointment-own', action: 'read', isOwner: () => () => true }) },
    async (request) => {
      const studentId = await resolveOwnUserId(request, deps.getSession);
      const { id } = request.params as { id: string };
      const result = await deps.getQueuePosition.execute(id, studentId);
      if (!result.ok) throw result.error;

      return {
        serialNumber: result.value.serialNumber,
        patientsAhead: result.value.patientsAhead,
        nowServingSerial: result.value.nowServingSerial,
        currentEstimate: result.value.currentEstimate?.toISOString() ?? null,
        sessionStatus: result.value.sessionStatus,
        asOf: result.value.asOf.toISOString(),
        pollAfterSeconds: result.value.pollAfterSeconds,
      };
    },
  );
}
