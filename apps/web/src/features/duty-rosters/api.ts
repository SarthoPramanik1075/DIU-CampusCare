import { apiDelete, apiGet, apiPatch, apiPost } from '../../infrastructure/api-client.js';

const CORE_API_URL = import.meta.env.VITE_CORE_API_URL;

/** API §3.2's duty-roster shape. `weekday` is 0 (Sunday) through 6 (Saturday), the Postgres `DOW`/API convention used throughout. */
export interface DutyRosterDto {
  readonly rosterId: string;
  readonly doctorId: string;
  readonly weekday: number;
  readonly startsAtLocal: string;
  readonly endsAtLocal: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly isActive: boolean;
  readonly version: number;
}

export function fetchDutyRosters(doctorId: string): Promise<{ readonly items: readonly DutyRosterDto[] }> {
  return apiGet(CORE_API_URL, `/api/v1/doctors/${doctorId}/duty-rosters`);
}

export interface CreateDutyRosterInput {
  readonly weekday: number;
  readonly startsAtLocal: string;
  readonly endsAtLocal: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export function createDutyRoster(doctorId: string, input: CreateDutyRosterInput, csrfToken: string): Promise<DutyRosterDto> {
  return apiPost<DutyRosterDto>(CORE_API_URL, `/api/v1/doctors/${doctorId}/duty-rosters`, input, csrfToken);
}

export interface UpdateDutyRosterInput {
  readonly weekday?: number;
  readonly startsAtLocal?: string;
  readonly endsAtLocal?: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string | null;
  readonly version: number;
}

export function updateDutyRoster(rosterId: string, input: UpdateDutyRosterInput, csrfToken: string): Promise<DutyRosterDto> {
  return apiPatch<DutyRosterDto>(CORE_API_URL, `/api/v1/duty-rosters/${rosterId}`, input, csrfToken);
}

/** API §3.2's `DELETE` soft-deactivates (`is_active: false`) — the row is retained, P4. */
export function deleteDutyRoster(rosterId: string, reason: string, csrfToken: string): Promise<void> {
  return apiDelete<undefined>(CORE_API_URL, `/api/v1/duty-rosters/${rosterId}`, { reason }, csrfToken);
}
