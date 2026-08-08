import { toBstIsoString } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';

import type { AuthorizationRouteConfig, PolicyEnforcementHandler } from '../../../../kernel/authz/policy-enforcement-point.js';
import type { GetPublicAvailabilityQuery } from '../../application/queries/get-public-availability.query.js';

export interface PublicAvailabilityRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getPublicAvailability: GetPublicAvailabilityQuery;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** `GET /api/v1/public/availability` (API §2.2) — the login-free availability view, `resource: 'public-availability-view'` (matrix: `ANON: READ_ANY`). */
export function registerPublicAvailabilityRoutes(app: FastifyInstance, deps: PublicAvailabilityRouteDeps): void {
  app.get('/api/v1/public/availability', { preHandler: deps.pep({ resource: 'public-availability-view', action: 'read' }) }, async (request, reply) => {
    const query = request.query as { from?: unknown; to?: unknown; doctorId?: unknown };

    const result = await deps.getPublicAvailability.execute(
      isNonEmptyString(query.from) ? query.from : undefined,
      isNonEmptyString(query.to) ? query.to : undefined,
      isNonEmptyString(query.doctorId) ? query.doctorId : undefined,
    );
    if (!result.ok) throw result.error;

    reply.header('Cache-Control', 'public, max-age=60');
    return {
      days: result.value.days.map((day) => ({
        date: day.date,
        isServiceDay: day.isServiceDay,
        closureReason: day.closureReason,
        sessions: day.sessions.map((session) => ({
          sessionId: session.sessionId,
          doctorId: session.doctorId,
          doctorName: session.doctorName,
          designation: session.designation,
          specialisation: session.specialisation,
          photoUrl: session.photoUrl,
          startsAt: toBstIsoString(session.startsAt),
          endsAt: toBstIsoString(session.endsAt),
          status: session.status,
          bookableSlotCount: session.bookableSlotCount,
          bookedSlotCount: session.bookedSlotCount,
          remainingSlotCount: session.bookableSlotCount - session.bookedSlotCount,
        })),
      })),
      asOf: toBstIsoString(result.value.asOf),
      publicationWindowDays: result.value.publicationWindowDays,
    };
  });
}
