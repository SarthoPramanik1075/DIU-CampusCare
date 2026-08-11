import type { RoleCode } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';

import type { AuthorizationRouteConfig, PolicyEnforcementHandler } from '../../../../kernel/authz/policy-enforcement-point.js';
import { AuthorizationError, ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import { getIdempotencyKey } from '../../../../kernel/http/idempotency.js';
import { resolveOwnUserId, SESSION_COOKIE_NAME, unauthenticatedError, type GetSessionQuery } from '../../../iam/index.js';
import type { AdvanceAppointmentHandler, AdvanceResult } from '../../application/advance-appointment.handler.js';
import type { AppointmentDetail, AppointmentListScope, BookedAppointment, CancelledAppointment, MyAppointmentListItem } from '../../application/appointment-repository.js';
import type { BookAppointmentHandler } from '../../application/book-appointment.handler.js';
import { appointmentNotFoundError, type CancelAppointmentHandler } from '../../application/cancel-appointment.handler.js';
import type { CheckInAppointmentHandler, CheckInResult } from '../../application/check-in-appointment.handler.js';
import type { MarkEmergencyHandler, MarkEmergencyResult } from '../../application/mark-emergency.handler.js';
import type { MarkNoShowHandler, MarkNoShowResult } from '../../application/mark-no-show.handler.js';
import type { AppointmentViewerRole, GetAppointmentDetailQuery } from '../../application/queries/get-appointment-detail.query.js';
import type { AvailabilitySessionItem, GetAvailabilityQuery } from '../../application/queries/get-availability.query.js';
import type { BookingSuspensionState, GetBookingSuspensionQuery } from '../../application/queries/get-booking-suspension.query.js';
import type { GetQueuePositionQuery } from '../../application/queries/get-queue-position.query.js';
import type { ListMyAppointmentsQuery } from '../../application/queries/list-my-appointments.query.js';
import type { ReverseAppointmentStatusHandler, ReverseAppointmentStatusResult } from '../../application/reverse-appointment-status.handler.js';
import { canCancel, type AppointmentStatus } from '../../domain/appointment-status.js';

export interface AppointmentRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly getAvailability: GetAvailabilityQuery;
  readonly bookAppointment: BookAppointmentHandler;
  readonly listMyAppointments: ListMyAppointmentsQuery;
  readonly getAppointmentDetail: GetAppointmentDetailQuery;
  readonly cancelAppointment: CancelAppointmentHandler;
  readonly getQueuePosition: GetQueuePositionQuery;
  readonly getBookingSuspension: GetBookingSuspensionQuery;
  readonly checkInAppointment: CheckInAppointmentHandler;
  readonly advanceAppointment: AdvanceAppointmentHandler;
  readonly markNoShow: MarkNoShowHandler;
  readonly reverseAppointmentStatus: ReverseAppointmentStatusHandler;
  readonly markEmergency: MarkEmergencyHandler;
}

const ADVANCE_TARGETS: readonly AppointmentStatus[] = ['waiting', 'in_consultation', 'completed'];

function isAdvanceTarget(value: unknown): value is AppointmentStatus {
  return typeof value === 'string' && (ADVANCE_TARGETS as readonly string[]).includes(value);
}

const REVERSAL_TARGETS: readonly AppointmentStatus[] = ['booked', 'checked_in', 'waiting', 'in_consultation'];

function isReversalTarget(value: unknown): value is AppointmentStatus {
  return typeof value === 'string' && (REVERSAL_TARGETS as readonly string[]).includes(value);
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

/** Every queue-transition response carries this — real once M3-G's recalculation engine exists; honestly `false` until then rather than fabricated. */
const ESTIMATES_RECALCULATED_PLACEHOLDER = false;

function checkInDto(result: CheckInResult) {
  return {
    appointmentId: result.appointment.appointmentId,
    status: result.appointment.status,
    checkedInAt: result.appointment.checkedInAt?.toISOString() ?? null,
    serialNumber: result.appointment.serialNumber,
    position: result.position,
    permittedTransitions: result.permittedTransitions,
    enteredRetrospectively: false,
    version: result.appointment.version,
  };
}

function advanceDto(result: AdvanceResult) {
  return {
    appointmentId: result.appointment.appointmentId,
    status: result.appointment.status,
    consultationStartedAt: result.appointment.consultationStartedAt?.toISOString() ?? null,
    consultationCompletedAt: result.appointment.consultationCompletedAt?.toISOString() ?? null,
    paymentOverrideRecorded: result.paymentOverrideRecorded,
    permittedTransitions: result.permittedTransitions,
    estimatesRecalculated: ESTIMATES_RECALCULATED_PLACEHOLDER,
    version: result.appointment.version,
  };
}

function noShowDto(result: MarkNoShowResult) {
  return {
    appointmentId: result.appointment.appointmentId,
    status: result.appointment.status,
    noShowMarkedAt: result.appointment.noShowMarkedAt?.toISOString() ?? null,
    noShowMarkedBy: result.appointment.noShowMarkedBy,
    rollingNoShowCount: result.rollingNoShowCount,
    suspensionApplied: result.suspensionApplied === null ? null : { suspendedUntil: result.suspensionApplied.suspendedUntil.toISOString(), walkInRemainsAvailable: true },
    estimatesRecalculated: ESTIMATES_RECALCULATED_PLACEHOLDER,
    version: result.appointment.version,
  };
}

function reverseDto(result: ReverseAppointmentStatusResult, reason: string) {
  return {
    appointmentId: result.appointment.appointmentId,
    status: result.appointment.status,
    reversedFrom: result.reversedFrom,
    reversalReason: reason,
    suspensionRecalculated: result.suspensionRecalculated,
    version: result.appointment.version,
  };
}

function emergencyDto(result: MarkEmergencyResult) {
  return {
    appointmentId: result.appointment.appointmentId,
    isEmergency: result.appointment.isEmergency,
    position: result.position,
    serialNumber: result.appointment.serialNumber,
    patientsNotified: result.patientsNotified,
    notificationSuppressed: result.notificationSuppressed,
    estimatesRecalculated: ESTIMATES_RECALCULATED_PLACEHOLDER,
    version: result.appointment.version,
  };
}

function requireVersion(body: { version?: unknown }): number {
  if (typeof body.version !== 'number') {
    throw new ValidationError({ code: 'VALIDATION_FAILED', message: 'Include the current version.', fields: [{ field: 'version', rule: 'VR-92', message: 'Required' }] });
  }
  return body.version;
}

function bookingSuspensionDto(state: BookingSuspensionState) {
  return {
    suspendedUntil: state.suspendedUntil.toISOString(),
    reason: state.reason,
    walkInRemainsAvailable: state.walkInRemainsAvailable,
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

    const result = await deps.cancelAppointment.execute({
      appointmentId: id,
      requesterId: session.userId,
      requesterRole,
      reason: typeof body.reason === 'string' ? body.reason : null,
      expectedVersion: requireVersion(body),
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

  app.get(
    '/api/v1/me/booking-suspension',
    { preHandler: deps.pep({ resource: 'appointment-own', action: 'read', isOwner: () => () => true }) },
    async (request) => {
      const studentId = await resolveOwnUserId(request, deps.getSession);
      const state = await deps.getBookingSuspension.execute(studentId);
      return state === null ? null : bookingSuspensionDto(state);
    },
  );

  app.post(
    '/api/v1/appointments/:id/check-in',
    { preHandler: deps.pep({ resource: 'live-queue', action: 'update' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { version?: unknown };
      const actorId = await resolveOwnUserId(request, deps.getSession);

      const result = await deps.checkInAppointment.execute({
        appointmentId: id,
        expectedVersion: requireVersion(body),
        idempotencyKey: getIdempotencyKey(request),
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;

      return checkInDto(result.value);
    },
  );

  app.post(
    '/api/v1/appointments/:id/advance',
    { preHandler: deps.pep({ resource: 'live-queue', action: 'update' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { toStatus?: unknown; paymentOverrideReason?: unknown; version?: unknown };
      if (!isAdvanceTarget(body.toStatus)) {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Choose a valid next status.',
          fields: [{ field: 'toStatus', rule: 'VR-28', message: 'Must be waiting, in_consultation or completed' }],
        });
      }
      const actorId = await resolveOwnUserId(request, deps.getSession);

      const result = await deps.advanceAppointment.execute({
        appointmentId: id,
        toStatus: body.toStatus,
        paymentOverrideReason: typeof body.paymentOverrideReason === 'string' ? body.paymentOverrideReason : null,
        expectedVersion: requireVersion(body),
        idempotencyKey: getIdempotencyKey(request),
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;

      return advanceDto(result.value);
    },
  );

  app.post(
    '/api/v1/appointments/:id/no-show',
    { preHandler: deps.pep({ resource: 'live-queue', action: 'update' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { reason?: unknown; version?: unknown };
      const actorId = await resolveOwnUserId(request, deps.getSession);

      const result = await deps.markNoShow.execute({
        appointmentId: id,
        reason: typeof body.reason === 'string' ? body.reason : null,
        expectedVersion: requireVersion(body),
        idempotencyKey: getIdempotencyKey(request),
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;

      return noShowDto(result.value);
    },
  );

  app.post(
    '/api/v1/appointments/:id/reverse',
    { preHandler: deps.pep({ resource: 'live-queue', action: 'update' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { toStatus?: unknown; reason?: unknown; version?: unknown };
      if (!isReversalTarget(body.toStatus)) {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Choose a valid state to revert to.',
          fields: [{ field: 'toStatus', rule: 'VR-32', message: 'Must be a state this entry previously held' }],
        });
      }
      if (typeof body.reason !== 'string') {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Give a reason of at least 10 characters for the correction.',
          fields: [{ field: 'reason', rule: 'VR-93', message: 'Required' }],
        });
      }
      const actorId = await resolveOwnUserId(request, deps.getSession);

      const result = await deps.reverseAppointmentStatus.execute({
        appointmentId: id,
        toStatus: body.toStatus,
        reason: body.reason,
        expectedVersion: requireVersion(body),
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;

      return reverseDto(result.value, body.reason);
    },
  );

  app.post(
    '/api/v1/appointments/:id/emergency',
    { preHandler: deps.pep({ resource: 'emergency-designation', action: 'create' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { reason?: unknown; version?: unknown };
      if (typeof body.reason !== 'string') {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Give a reason of at least 10 characters for the emergency.',
          fields: [{ field: 'reason', rule: 'VR-30', message: 'Required' }],
        });
      }
      const actorId = await resolveOwnUserId(request, deps.getSession);

      const result = await deps.markEmergency.execute({
        appointmentId: id,
        reason: body.reason,
        expectedVersion: requireVersion(body),
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;

      return emergencyDto(result.value);
    },
  );
}
