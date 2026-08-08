import { createRootRoute, createRoute, createRouter, redirect, Outlet } from '@tanstack/react-router';

import { fetchSession } from '../features/auth/api.js';
import { ApiError } from '../infrastructure/api-client.js';
import { ConfirmResetPage } from '../routes/ConfirmResetPage.js';
import { ErrorPage } from '../routes/ErrorPage.js';
import { LandingPage } from '../routes/LandingPage.js';
import { NoAccessPage } from '../routes/NoAccessPage.js';
import { NotFoundPage } from '../routes/NotFoundPage.js';
import { RequestResetPage } from '../routes/RequestResetPage.js';
import { SessionExpiredPage } from '../routes/SessionExpiredPage.js';
import { SignInPage } from '../routes/SignInPage.js';
import { StudentDashboardPage } from '../routes/StudentDashboardPage.js';

/**
 * Code-based routing (no file-based codegen) — matches M0.5's original
 * choice. `notFoundComponent`/`errorComponent` on the root route are X-01/
 * X-03 (FRONTEND §10.13): every route falls back to them by default, not
 * only the ones that explicitly opt in.
 */
const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFoundPage,
  errorComponent: ({ error }) => <ErrorPage error={error} />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  validateSearch: (search: Record<string, unknown>): { redirectTo?: string } =>
    typeof search.redirectTo === 'string' ? { redirectTo: search.redirectTo } : {},
  component: SignInPage,
});

const requestResetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: RequestResetPage,
});

const confirmResetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password/confirm',
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === 'string' ? { token: search.token } : {},
  component: ConfirmResetPage,
});

const studentDashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/student',
  loader: async () => {
    let session;
    try {
      session = await fetchSession();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({ to: '/sign-in', search: { redirectTo: '/student' } });
      }
      throw error;
    }
    // FR-DASH-01: the dashboard is a student-only surface. Checked here,
    // against the roles the session itself carries, rather than letting
    // the dashboard query's own 403 FORBIDDEN (GetStudentDashboardQuery)
    // surface as a generic error banner.
    if (!session.roles.includes('STU')) {
      throw redirect({ to: '/no-access' });
    }
    return { session };
  },
  component: () => {
    const { session } = studentDashboardRoute.useLoaderData();
    return <StudentDashboardPage session={session} />;
  },
});

const noAccessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/no-access',
  component: NoAccessPage,
});

const errorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/error',
  component: () => <ErrorPage />,
});

const sessionExpiredRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session-expired',
  component: SessionExpiredPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  requestResetRoute,
  confirmResetRoute,
  studentDashboardRoute,
  noAccessRoute,
  errorRoute,
  sessionExpiredRoute,
]);

export const router = createRouter({ routeTree, defaultNotFoundComponent: NotFoundPage });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
