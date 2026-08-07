import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';

import { LandingPage } from '../routes/LandingPage.js';

/**
 * Code-based routing (no file-based codegen) — this checkpoint ships one
 * route. TanStack Router is the confirmed stack choice (ROADMAP.md) so that
 * later milestones' routes join a router that already exists rather than
 * one bolted on retroactively.
 */
const rootRoute = createRootRoute({
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
