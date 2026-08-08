import type { FastifyInstance } from 'fastify';

import type { AuthorizationRouteConfig, PolicyEnforcementHandler } from '../../../../kernel/authz/policy-enforcement-point.js';
import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { getCorrelationId } from '../../../../kernel/http/correlation.js';
import { resolveOwnUserId, type GetSessionQuery } from '../../../iam/index.js';
import type { CreateDoctorHandler } from '../../application/create-doctor.handler.js';
import type { DeactivateDoctorHandler } from '../../application/deactivate-doctor.handler.js';
import type { DeleteDoctorHandler } from '../../application/delete-doctor.handler.js';
import type { DoctorDetail, DoctorListItem } from '../../application/doctor-repository.js';
import type { GetDoctorQuery } from '../../application/queries/get-doctor.query.js';
import type { ListDoctorsQuery } from '../../application/queries/list-doctors.query.js';
import { doctorNotFoundError, type UpdateDoctorHandler } from '../../application/update-doctor.handler.js';

export interface DoctorRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly getSession: GetSessionQuery;
  readonly listDoctors: ListDoctorsQuery;
  readonly getDoctor: GetDoctorQuery;
  readonly createDoctor: CreateDoctorHandler;
  readonly updateDoctor: UpdateDoctorHandler;
  readonly deactivateDoctor: DeactivateDoctorHandler;
  readonly deleteDoctor: DeleteDoctorHandler;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function doctorListItemDto(item: DoctorListItem) {
  return {
    doctorId: item.doctorId,
    fullName: item.fullName,
    designation: item.designation,
    specialisation: item.specialisation,
    photoUrl: item.photoUrl,
    isActive: item.isActive,
    version: item.version,
  };
}

function doctorDetailDto(doctor: DoctorDetail) {
  return {
    doctorId: doctor.doctorId,
    userAccountId: doctor.userAccountId,
    fullName: doctor.fullName,
    designation: doctor.designation,
    specialisation: doctor.specialisation,
    photoUrl: doctor.photoUrl,
    isActive: doctor.isActive,
    activeRosterCount: doctor.activeRosterCount,
    upcomingSessionCount: doctor.upcomingSessionCount,
    version: doctor.version,
  };
}

function requireReasonAndVersion<T extends { reason?: unknown; version?: unknown }>(
  body: T,
): asserts body is T & { reason: string; version: number } {
  if (!isNonEmptyString(body.reason) || typeof body.version !== 'number') {
    throw new ValidationError({
      code: 'VALIDATION_FAILED',
      message: 'Enter a reason and include the current version.',
      fields: [
        ...(isNonEmptyString(body.reason) ? [] : [{ field: 'reason', rule: 'VR-93', message: 'Required' }]),
        ...(typeof body.version === 'number' ? [] : [{ field: 'version', rule: 'VR-92', message: 'Required' }]),
      ],
    });
  }
}

/** API §3.1 — doctor profile administration. Every route runs through the PEP against `doctor-profiles`; the matrix's `ANON: read` grant is what makes the read routes effectively public (API's own "Auth: None"). */
export function registerDoctorRoutes(app: FastifyInstance, deps: DoctorRouteDeps): void {
  app.get(
    '/api/v1/doctors',
    { preHandler: deps.pep({ resource: 'doctor-profiles', action: 'read' }) },
    async (request) => {
      const query = request.query as { isActive?: unknown; q?: unknown; limit?: unknown; cursor?: unknown };
      const isActive = query.isActive === 'false' ? false : query.isActive === 'true' ? true : undefined;
      const result = await deps.listDoctors.execute({
        ...(isActive === undefined ? {} : { isActive }),
        ...(typeof query.q === 'string' ? { q: query.q } : {}),
        ...(typeof query.limit === 'string' ? { limit: Number.parseInt(query.limit, 10) } : {}),
        ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
      });
      if (!result.ok) throw result.error;
      return { items: result.value.items.map(doctorListItemDto), nextCursor: result.value.nextCursor };
    },
  );

  app.post(
    '/api/v1/doctors',
    { preHandler: deps.pep({ resource: 'doctor-profiles', action: 'create' }) },
    async (request, reply) => {
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as {
        fullName?: unknown;
        designation?: unknown;
        specialisation?: unknown;
        photoUrl?: unknown;
        userAccountId?: unknown;
        locationId?: unknown;
      };

      if (!isNonEmptyString(body.fullName)) {
        throw new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Enter a full name.',
          fields: [{ field: 'fullName', rule: 'VALIDATION_FAILED', message: 'Required' }],
        });
      }

      const result = await deps.createDoctor.execute({
        fullName: body.fullName,
        designation: typeof body.designation === 'string' ? body.designation : null,
        specialisation: typeof body.specialisation === 'string' ? body.specialisation : null,
        photoUrl: typeof body.photoUrl === 'string' ? body.photoUrl : null,
        userAccountId: typeof body.userAccountId === 'string' ? body.userAccountId : null,
        locationId: typeof body.locationId === 'string' ? body.locationId : undefined,
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;

      reply.status(201);
      return doctorDetailDto(result.value);
    },
  );

  app.get(
    '/api/v1/doctors/:id',
    { preHandler: deps.pep({ resource: 'doctor-profiles', action: 'read' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const doctor = await deps.getDoctor.execute(id);
      if (doctor === null) throw doctorNotFoundError();
      return doctorDetailDto(doctor);
    },
  );

  app.patch(
    '/api/v1/doctors/:id',
    { preHandler: deps.pep({ resource: 'doctor-profiles', action: 'update' }) },
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

      const result = await deps.updateDoctor.execute({
        doctorId: id,
        fullName: typeof body.fullName === 'string' ? body.fullName : undefined,
        designation: 'designation' in body ? (body.designation as string | null) : undefined,
        specialisation: 'specialisation' in body ? (body.specialisation as string | null) : undefined,
        photoUrl: 'photoUrl' in body ? (body.photoUrl as string | null) : undefined,
        expectedVersion: body.version,
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;
      return doctorDetailDto(result.value);
    },
  );

  app.post(
    '/api/v1/doctors/:id/deactivate',
    { preHandler: deps.pep({ resource: 'doctor-profiles', action: 'update' }) },
    async (request) => {
      const { id } = request.params as { id: string };
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const body = request.body as { reason?: unknown; version?: unknown };
      requireReasonAndVersion(body);

      const result = await deps.deactivateDoctor.execute({
        doctorId: id,
        reason: body.reason,
        expectedVersion: body.version,
        actorId,
        correlationId: getCorrelationId(request),
      });
      if (!result.ok) throw result.error;
      return {
        doctorId: result.value.doctor.doctorId,
        isActive: result.value.doctor.isActive,
        affectedUpcomingSessions: result.value.affectedUpcomingSessions,
        message:
          'Upcoming sessions remain scheduled. Cancel them or record unavailability to release the bookings.',
        version: result.value.doctor.version,
      };
    },
  );

  app.delete(
    '/api/v1/doctors/:id',
    { preHandler: deps.pep({ resource: 'doctor-profiles', action: 'delete' }) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const actorId = await resolveOwnUserId(request, deps.getSession);
      const result = await deps.deleteDoctor.execute({ doctorId: id, actorId, correlationId: getCorrelationId(request) });
      if (!result.ok) throw result.error;
      reply.status(204);
    },
  );
}
