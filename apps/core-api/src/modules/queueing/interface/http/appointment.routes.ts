import type { FastifyInstance } from 'fastify';

import type { AuthorizationRouteConfig, PolicyEnforcementHandler } from '../../../../kernel/authz/policy-enforcement-point.js';
import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import { resolveOwnUserId, SESSION_COOKIE_NAME, type GetSessionQuery } from '../../../iam/index.js';
import type { BookedAppointment } from '../../application/appointment-repository.js';
import type { BookAppointmentHandler } from '../../application/book-appointment.handler.js';
import type { AvailabilitySessionItem, GetAvailabilityQuery } from '../../application/queries/get-availability.query.js';

export interface AppointmentRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly getAvailability: GetAvailabilityQuery;
  readonly bookAppointment: BookAppointmentHandler;
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
}
