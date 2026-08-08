/**
 * The config module's public interface — DR-2. Nothing outside this module
 * imports from `domain/`, `application/` or `infrastructure/` directly.
 */
export { isActive, type Announcement } from './domain/announcement.js';
export { ListActiveAnnouncementsHandler } from './application/queries/list-active-announcements.query.js';
export type { AnnouncementRepository } from './application/announcement-repository.js';
export { KyselyAnnouncementRepository } from './infrastructure/announcement.repository.js';
export {
  registerAnnouncementRoutes,
  type AnnouncementRouteDeps,
} from './interface/http/announcements.routes.js';

export { enumerateDates, isNonEmptyReason, isValidDateOrder, rangeDaysInclusive, type ServiceCalendarEntry } from './domain/service-calendar.js';
export type {
  ConflictingSession,
  CreateServiceCalendarOutcome,
  DeleteServiceCalendarOutcome,
  ServiceCalendarRepository,
  UpdateServiceCalendarOutcome,
} from './application/service-calendar-repository.js';
export { CreateServiceCalendarEntriesHandler, type CreateServiceCalendarEntriesInput, type CreateServiceCalendarEntriesResult } from './application/create-service-calendar-entries.handler.js';
export { UpdateServiceCalendarEntryHandler, serviceCalendarEntryNotFoundError, type UpdateServiceCalendarEntryInput } from './application/update-service-calendar-entry.handler.js';
export { DeleteServiceCalendarEntryHandler, type DeleteServiceCalendarEntryInput } from './application/delete-service-calendar-entry.handler.js';
export { ListServiceCalendarQuery } from './application/queries/list-service-calendar.query.js';
export { GetPublicServiceCalendarQuery } from './application/queries/get-public-service-calendar.query.js';
export { KyselyServiceCalendarRepository } from './infrastructure/service-calendar.repository.js';
export { registerServiceCalendarRoutes, type ServiceCalendarRouteDeps } from './interface/http/service-calendar.routes.js';
