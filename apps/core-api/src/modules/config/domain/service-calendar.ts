/**
 * Domain layer — DR-6. FR-SCH-10/BR-28: non-service days are an
 * exceptions list, not a full calendar — the absence of a row means the
 * day is open, and a row can mark either a closure (`isServiceDay: false`)
 * or an explicit reopening of a day that would otherwise be closed.
 */
export interface ServiceCalendarEntry {
  readonly id: string;
  readonly locationId: string;
  readonly calendarDate: string;
  readonly isServiceDay: boolean;
  readonly reason: string;
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: Date;
  readonly version: number;
}

/** API §8.4 — non-empty, no minimum length (distinct from VR-93's 10-character rule elsewhere). */
export function isNonEmptyReason(reason: string): boolean {
  return reason.trim().length > 0;
}

/** API §8.4 — `toDate` on or after `fromDate`. */
export function isValidDateOrder(fromDate: string, toDate: string): boolean {
  return toDate >= fromDate;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Inclusive day count between two ISO dates — used for both the 366-day admin-create cap and the 90-day public-read cap. */
export function rangeDaysInclusive(fromDate: string, toDate: string): number {
  return Math.round((new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) / MS_PER_DAY) + 1;
}

/** API §8.4 — "a range creates one row per date." */
export function enumerateDates(fromDate: string, toDate: string): readonly string[] {
  const dates: string[] = [];
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
