import { toBstIsoString } from '@campuscare/shared-types';
import type { FastifyInstance } from 'fastify';

import type {
  AuthorizationRouteConfig,
  PolicyEnforcementHandler,
} from '../../../../kernel/authz/policy-enforcement-point.js';
import type { ListActiveAnnouncementsHandler } from '../../application/list-active-announcements.handler.js';

export interface AnnouncementRouteDeps {
  readonly pep: (config: AuthorizationRouteConfig) => PolicyEnforcementHandler;
  readonly listActiveAnnouncements: ListActiveAnnouncementsHandler;
}

/**
 * API §2.5 `GET /api/v1/public/announcements`.
 *
 * `resource: 'announcements', action: 'read'` runs through the same PEP →
 * PDP path every other route will, even though the permission matrix grants
 * it to `ANON` unconditionally — proving that path end to end, on the
 * simplest possible resource, is the point of this being the vertical
 * slice.
 *
 * `body` is returned as the plain text it was stored as (VR-90) — escaping
 * it against interpretation as markup is the rendering layer's job
 * (FRONTEND.md commits to never using `dangerouslySetInnerHTML` for it),
 * not something a JSON API response does or should do.
 */
export function registerAnnouncementRoutes(app: FastifyInstance, deps: AnnouncementRouteDeps): void {
  app.get(
    '/api/v1/public/announcements',
    { preHandler: deps.pep({ resource: 'announcements', action: 'read' }) },
    async () => {
      const items = await deps.listActiveAnnouncements.execute();
      return {
        items: items.map((announcement) => ({
          id: announcement.id,
          body: announcement.body,
          startsAt: toBstIsoString(announcement.startsAt),
          endsAt: toBstIsoString(announcement.endsAt),
        })),
      };
    },
  );
}
