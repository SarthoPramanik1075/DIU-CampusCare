import type { Kysely } from 'kysely';

import type { Database } from '../../infrastructure/database/client.js';
import type { Clock } from '../clock/clock.js';


/**
 * Reads `audit.break_glass_grant` — FR-AUD-05…07, PRM-14.
 *
 * `audit.break_glass_grant` lives in `campuscare_core`'s own audit schema
 * (ARCHITECTURE §3.3 places "Break-Glass Evaluator" inside the Core
 * Authorization Kernel), so this class is real, useful kernel code today
 * even though nothing in M0.5 calls it yet: the AUD module (M9) will use it
 * to check for an existing grant before issuing a new one, and it is the
 * component an internal endpoint will eventually wrap so that
 * counseling-api — which cannot reach this database at all (ADR-001) — can
 * ask "does this administrator currently hold an active grant?" without
 * ever being given a connection string.
 *
 * Deliberately read-only. Creating a grant means validating a
 * ≥20-character justification (already a database CHECK constraint,
 * `ck_break_glass_justification`) and firing the immediate notification to
 * the counseling service head (FR-AUD-06) — an application command with
 * side effects, belonging to the AUD module that issues it, not to a
 * cross-cutting kernel read.
 */
export class BreakGlassEvaluator {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly clock: Clock,
  ) {}

  /** True if `administratorId` currently holds a grant that is neither expired nor revoked. */
  async hasActiveGrant(administratorId: string): Promise<boolean> {
    const now = this.clock.now();
    const grant = await this.db
      .selectFrom('audit.break_glass_grant')
      .select('id')
      .where('administrator_id', '=', administratorId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst();
    return grant !== undefined;
  }
}
