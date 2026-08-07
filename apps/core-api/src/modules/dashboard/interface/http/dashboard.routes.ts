import { toBstIsoString } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';

import { AuthorizationError } from '../../../../kernel/errors/domain-error.js';
import { SESSION_COOKIE_NAME, type GetSessionQuery } from '../../../iam/index.js';
import type { GetStudentDashboardQuery, StudentDashboard } from '../../application/queries/get-student-dashboard.query.js';

export interface DashboardRouteDeps {
  readonly getSession: GetSessionQuery;
  readonly getStudentDashboard: GetStudentDashboardQuery;
}

function unauthenticatedError(): AuthorizationError {
  return new AuthorizationError({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.', httpStatus: 401 });
}

function dashboardDto(dashboard: StudentDashboard) {
  return {
    student: dashboard.student,
    upcomingAppointments: dashboard.upcomingAppointments,
    todaysDoctors: dashboard.todaysDoctors,
    medicineStore: dashboard.medicineStore,
    notifications: dashboard.notifications,
    announcements: dashboard.announcements.map((announcement) => ({
      id: announcement.id,
      body: announcement.body,
      endsAt: toBstIsoString(announcement.endsAt),
    })),
    bookingSuspension:
      dashboard.bookingSuspension === null
        ? null
        : { ...dashboard.bookingSuspension, suspendedUntil: toBstIsoString(dashboard.bookingSuspension.suspendedUntil) },
  };
}

/**
 * `GET /api/v1/me/dashboard` (API §2 DASH). Not PEP-gated — there is no
 * `dashboard` row in the 24-resource permission matrix (SRS §3.5.2); this
 * aggregates other modules' own resources rather than being one itself —
 * so, like `login`/`logout`/`session` in `modules/iam`'s own
 * `auth.routes.ts`, it checks for a valid session directly and lets
 * `GetStudentDashboardQuery` enforce the "student" part (FR-DASH-01).
 */
export function registerDashboardRoutes(app: FastifyInstance, deps: DashboardRouteDeps): void {
  app.get('/api/v1/me/dashboard', async (request) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    const session = sessionId === undefined ? null : await deps.getSession.execute(sessionId);
    if (session === null) throw unauthenticatedError();

    const result = await deps.getStudentDashboard.execute(session.userId);
    if (!result.ok) throw result.error;

    return dashboardDto(result.value);
  });
}
