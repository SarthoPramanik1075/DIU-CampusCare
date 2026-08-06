import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../infrastructure/database/client.js';

/**
 * The append-only general sink — FR-AUD-01/02, BR-60/61.
 *
 * `audit.audit_log` and `audit.authz_denial` are write-only from this
 * class's perspective: there is no `update` or `delete` method here, on
 * either table, and there never should be one — the tables enforce it
 * themselves with a trigger (DATABASE §9.2) and a `REVOKE` (DATABASE §11),
 * but the class not offering the method at all is the first line of
 * defence. Checkpoint F's architecture suite asserts every state-changing
 * command handler calls `recordChange` (DR-7); this class is what it calls.
 */
export interface AuditChangeInput {
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly action: string;
  readonly beforeState?: Readonly<Record<string, unknown>> | null;
  readonly afterState?: Readonly<Record<string, unknown>> | null;
  readonly actorId?: string | null;
  readonly actorRole?: string | null;
  readonly correlationId?: string | null;
}

/** PRM-12: every denied authorisation attempt, logged with actor, resource and timestamp. */
export interface AuditDenialInput {
  readonly actorId?: string | null;
  readonly attemptedRole?: string | null;
  readonly resource: string;
  readonly operation: string;
  readonly reason: string;
  readonly sourceAddress?: string | null;
  readonly correlationId?: string | null;
}

export class AuditRecorder {
  constructor(private readonly db: Kysely<Database>) {}

  async recordChange(input: AuditChangeInput): Promise<void> {
    await this.db
      .insertInto('audit.audit_log')
      .values({
        id: uuidv7(),
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        action: input.action,
        before_state: input.beforeState ?? null,
        after_state: input.afterState ?? null,
        actor_id: input.actorId ?? null,
        actor_role: input.actorRole ?? null,
        correlation_id: input.correlationId ?? null,
      })
      .execute();
  }

  async recordDenial(input: AuditDenialInput): Promise<void> {
    await this.db
      .insertInto('audit.authz_denial')
      .values({
        id: uuidv7(),
        actor_id: input.actorId ?? null,
        attempted_role: input.attemptedRole ?? null,
        resource: input.resource,
        operation: input.operation,
        reason: input.reason,
        source_address: input.sourceAddress ?? null,
        correlation_id: input.correlationId ?? null,
      })
      .execute();
  }

  /** FR-AUD-03: access to a student's personal data by a non-owning user. */
  async recordDataAccess(input: {
    readonly accessorId: string;
    readonly subjectId: string;
    readonly dataCategory: string;
    readonly correlationId?: string | null;
  }): Promise<void> {
    await this.db
      .insertInto('audit.data_access_log')
      .values({
        id: uuidv7(),
        accessor_id: input.accessorId,
        subject_id: input.subjectId,
        data_category: input.dataCategory,
        correlation_id: input.correlationId ?? null,
      })
      .execute();
  }
}
