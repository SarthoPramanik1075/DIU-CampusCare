/**
 * Domain layer — DR-6. BR-42: `store_hours` is the default source of
 * truth; a same-day `store_status_override` (never a mutable flag —
 * `pharmacy.store_status_override` is a dated row, DATABASE §8) wins over
 * it when one exists.
 */
export interface MedicineStoreState {
  readonly isOpen: boolean;
  /**
   * `null` only when no `store_hours` row exists for today at all — no
   * admin screen writes this table until M5/M7, so this is the honest,
   * currently-always-true state in M1, not a fabricated `"09:00"`.
   */
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly stateSource: 'scheduled_hours' | 'manual_override';
}

export interface ScheduledHours {
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface StatusOverride {
  readonly isClosed: boolean;
}

export function computeMedicineStoreState(
  nowTimeOfDay: string,
  hours: ScheduledHours | null,
  override: StatusOverride | null,
): MedicineStoreState {
  if (override !== null) {
    return { isOpen: !override.isClosed, opensAt: hours?.opensAt ?? null, closesAt: hours?.closesAt ?? null, stateSource: 'manual_override' };
  }
  if (hours === null) {
    return { isOpen: false, opensAt: null, closesAt: null, stateSource: 'scheduled_hours' };
  }
  const isOpen = nowTimeOfDay >= hours.opensAt && nowTimeOfDay < hours.closesAt;
  return { isOpen, opensAt: hours.opensAt, closesAt: hours.closesAt, stateSource: 'scheduled_hours' };
}
