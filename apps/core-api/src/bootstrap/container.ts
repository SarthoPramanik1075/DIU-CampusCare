import type { Kysely } from 'kysely';
import type { Logger } from 'pino';

import { createDatabase, type Database } from '../infrastructure/database/client.js';
import { AuditRecorder } from '../kernel/audit/audit-recorder.js';
import { PolicyDecisionPoint } from '../kernel/authz/policy-decision-point.js';
import { SystemClock, type Clock } from '../kernel/clock/clock.js';
import { EventBus } from '../kernel/events/event-bus.js';
import { createLogger } from '../kernel/logging/logger.js';
import { PolicyStore } from '../kernel/policy/policy-store.js';
import { ListActiveAnnouncementsHandler } from '../modules/config/application/list-active-announcements.handler.js';
import { KyselyAnnouncementRepository } from '../modules/config/infrastructure/announcement.repository.js';

import type { AppConfig } from './config.js';

/**
 * The composition root — DR-5: every infrastructure adapter (the database
 * pool, the logger) is constructed exactly once, here, and handed down by
 * constructor injection. No kernel component and no module ever constructs
 * its own database connection.
 */
export interface Container {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly eventBus: EventBus;
  readonly policyStore: PolicyStore;
  readonly auditRecorder: AuditRecorder;
  readonly pdp: PolicyDecisionPoint;
  readonly listActiveAnnouncements: ListActiveAnnouncementsHandler;
}

export function buildContainer(config: AppConfig): Container {
  const logger = createLogger({ name: 'core-api', level: config.logLevel });
  const db = createDatabase(config.databaseUrl);
  const clock = new SystemClock();
  const eventBus = new EventBus();
  const policyStore = new PolicyStore(db);
  const auditRecorder = new AuditRecorder(db);
  const pdp = new PolicyDecisionPoint();

  const announcementRepository = new KyselyAnnouncementRepository(db);
  const listActiveAnnouncements = new ListActiveAnnouncementsHandler(announcementRepository, clock);

  return {
    config,
    logger,
    db,
    clock,
    eventBus,
    policyStore,
    auditRecorder,
    pdp,
    listActiveAnnouncements,
  };
}

export async function closeContainer(container: Container): Promise<void> {
  await container.db.destroy();
}
