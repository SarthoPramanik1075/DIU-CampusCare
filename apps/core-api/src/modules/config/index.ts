/**
 * The config module's public interface — DR-2. Nothing outside this module
 * imports from `domain/`, `application/` or `infrastructure/` directly.
 */
export { isActive, type Announcement } from './domain/announcement.js';
export { ListActiveAnnouncementsHandler } from './application/list-active-announcements.handler.js';
export type { AnnouncementRepository } from './application/announcement-repository.js';
export { KyselyAnnouncementRepository } from './infrastructure/announcement.repository.js';
export {
  registerAnnouncementRoutes,
  type AnnouncementRouteDeps,
} from './interface/http/announcements.routes.js';
