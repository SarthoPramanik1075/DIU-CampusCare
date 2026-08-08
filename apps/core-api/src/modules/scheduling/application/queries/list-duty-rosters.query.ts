import type { DutyRoster, DutyRosterListFilter, DutyRosterRepository } from '../duty-roster-repository.js';

/** `GET /api/v1/doctors/{id}/duty-rosters` (API §3.2). */
export class ListDutyRostersQuery {
  constructor(private readonly repository: DutyRosterRepository) {}

  execute(filter: DutyRosterListFilter): Promise<readonly DutyRoster[]> {
    return this.repository.listDutyRosters(filter);
  }
}
