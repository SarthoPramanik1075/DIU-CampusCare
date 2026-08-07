import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';

import { ErrorPage } from '../routes/ErrorPage.js';
import { LandingPage } from '../routes/LandingPage.js';
import { NoAccessPage } from '../routes/NoAccessPage.js';
import { NotFoundPage } from '../routes/NotFoundPage.js';
import { SessionExpiredPage } from '../routes/SessionExpiredPage.js';
import { SignInPage } from '../routes/SignInPage.js';

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

const routeTree = rootRoute.addChildren([indexRoute, signInRoute, noAccessRoute, errorRoute, sessionExpiredRoute]);

export const router = createRouter({ routeTree, defaultNotFoundComponent: NotFoundPage });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
