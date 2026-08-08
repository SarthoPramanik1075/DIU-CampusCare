import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '../../../infrastructure/database/client.js';
import type {
  CreateDutyRosterInput,
  CreateDutyRosterResult,
  DeleteDutyRosterOutcome,
  DutyRoster,
  DutyRosterListFilter,
  DutyRosterRepository,
  UpdateDutyRosterInput,
  UpdateDutyRosterOutcome,
} from '../application/duty-roster-repository.js';

function toDutyRoster(row: {
  id: string;
  doctor_id: string;
  weekday: number;
  starts_at_local: string;
  ends_at_local: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  version: number;
}): DutyRoster {
  return {
    rosterId: row.id,
    doctorId: row.doctor_id,
    weekday: row.weekday,
    startsAtLocal: row.starts_at_local,
    endsAtLocal: row.ends_at_local,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isActive: row.is_active,
    version: row.version,
  };
}

export class KyselyDutyRosterRepository implements DutyRosterRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listDutyRosters(filter: DutyRosterListFilter): Promise<readonly DutyRoster[]> {
    let query = this.db.selectFrom('scheduling.duty_roster').selectAll().where('doctor_id', '=', filter.doctorId);
    if (filter.isActive !== undefined) query = query.where('is_active', '=', filter.isActive);
    const rows = await query.orderBy('weekday').orderBy('starts_at_local').execute();
    return rows.map(toDutyRoster);
  }

  async findDutyRosterById(rosterId: string): Promise<DutyRoster | null> {
    const row = await this.db.selectFrom('scheduling.duty_roster').selectAll().where('id', '=', rosterId).executeTakeFirst();
    return row === undefined ? null : toDutyRoster(row);
  }

  async doctorExists(doctorId: string): Promise<boolean> {
    const row = await this.db.selectFrom('scheduling.doctor').select('id').where('id', '=', doctorId).executeTakeFirst();
    return row !== undefined;
  }

  /**
   * RST-01 (`000_AMENDMENTS.md`) — application-level overlap check, not a
   * GiST exclusion constraint. `excludeRosterId` lets `updateDutyRoster`
   * reuse this against every *other* active roster for the doctor/weekday,
   * so a roster never conflicts with its own prior values.
   */
  private async findOverlap(params: {
    readonly doctorId: string;
    readonly weekday: number;
    readonly startsAtLocal: string;
    readonly endsAtLocal: string;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
    readonly excludeRosterId?: string;
  }): Promise<DutyRoster | null> {
    let query = this.db
      .selectFrom('scheduling.duty_roster')
      .selectAll()
      .where('doctor_id', '=', params.doctorId)
      .where('weekday', '=', params.weekday)
      .where('is_active', '=', true)
      .where('starts_at_local', '<', params.endsAtLocal)
      .where('ends_at_local', '>', params.startsAtLocal)
      .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', params.effectiveFrom)]));

    if (params.effectiveTo !== null) {
      query = query.where('effective_from', '<=', params.effectiveTo);
    }
    if (params.excludeRosterId !== undefined) {
      query = query.where('id', '!=', params.excludeRosterId);
    }

    const row = await query.executeTakeFirst();
    return row === undefined ? null : toDutyRoster(row);
  }

  async createDutyRoster(input: CreateDutyRosterInput): Promise<CreateDutyRosterResult> {
    const conflict = await this.findOverlap(input);
    if (conflict !== null) return { outcome: 'overlap', conflictingRoster: conflict };

    const id = uuidv7();
    await this.db
      .insertInto('scheduling.duty_roster')
      .values({
        id,
        doctor_id: input.doctorId,
        weekday: input.weekday,
        starts_at_local: input.startsAtLocal,
        ends_at_local: input.endsAtLocal,
        effective_from: input.effectiveFrom,
        effective_to: input.effectiveTo,
        created_by: input.createdBy,
      })
      .execute();

    const roster = await this.findDutyRosterById(id);
    if (roster === null) throw new Error(`scheduling.duty_roster ${id} vanished immediately after its own creation`);
    return { outcome: 'created', roster };
  }

  async updateDutyRoster(input: UpdateDutyRosterInput): Promise<UpdateDutyRosterOutcome> {
    const current = await this.findDutyRosterById(input.rosterId);
    if (current === null) return { outcome: 'not_found' };

    const merged = {
      weekday: input.weekday ?? current.weekday,
      startsAtLocal: input.startsAtLocal ?? current.startsAtLocal,
      endsAtLocal: input.endsAtLocal ?? current.endsAtLocal,
      effectiveFrom: input.effectiveFrom ?? current.effectiveFrom,
      effectiveTo: input.effectiveTo === undefined ? current.effectiveTo : input.effectiveTo,
    };
    const conflict = await this.findOverlap({ doctorId: current.doctorId, ...merged, excludeRosterId: input.rosterId });
    if (conflict !== null) return { outcome: 'overlap', conflictingRoster: conflict };

    const row = await this.db
      .updateTable('scheduling.duty_roster')
      .set((eb) => ({
        weekday: merged.weekday,
        starts_at_local: merged.startsAtLocal,
        ends_at_local: merged.endsAtLocal,
        effective_from: merged.effectiveFrom,
        effective_to: merged.effectiveTo,
        version: eb('version', '+', 1),
      }))
      .where('id', '=', input.rosterId)
      .where('version', '=', input.expectedVersion)
      .returning('id')
      .executeTakeFirst();

    if (row === undefined) {
      const stillExists = await this.db.selectFrom('scheduling.duty_roster').select('id').where('id', '=', input.rosterId).executeTakeFirst();
      return stillExists === undefined ? { outcome: 'not_found' } : { outcome: 'stale' };
    }

    const roster = await this.findDutyRosterById(row.id);
    if (roster === null) throw new Error(`scheduling.duty_roster ${row.id} vanished immediately after its own update`);
    return { outcome: 'updated', roster };
  }

  async deleteDutyRoster(rosterId: string): Promise<DeleteDutyRosterOutcome> {
    const row = await this.db
      .updateTable('scheduling.duty_roster')
      .set({ is_active: false })
      .where('id', '=', rosterId)
      .returning('id')
      .executeTakeFirst();
    return row === undefined ? { outcome: 'not_found' } : { outcome: 'deleted' };
  }
}
