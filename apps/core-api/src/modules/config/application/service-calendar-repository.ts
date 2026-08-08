import type { ServiceCalendarEntry } from '../domain/service-calendar.js';

/** A session already on the books for a date the caller is about to close — reported, never auto-cancelled (API §8.4 — that would bypass FR-SCH-07's impact preview). */
export interface ConflictingSession {
  readonly sessionId: string;
  readonly doctorName: string;
  readonly sessionDate: string;
}

export type CreateServiceCalendarOutcome =
  | { readonly outcome: 'created'; readonly items: readonly ServiceCalendarEntry[]; readonly conflictingSessions: readonly ConflictingSession[] }
  | { readonly outcome: 'conflict'; readonly conflictingDate: string };

export type UpdateServiceCalendarOutcome =
  | { readonly outcome: 'updated'; readonly entry: ServiceCalendarEntry }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'not_found' };

export type DeleteServiceCalendarOutcome = 'deleted' | 'not_found';

/** Port for API §8.4–8.6's service-calendar administration and §2.6's public read. */
export interface ServiceCalendarRepository {
  /** The single Phase-1 location (OI-04/DB-3) — mirrors `DoctorRepository.findDefaultLocationId`. */
  findDefaultLocationId(): Promise<string>;
  listEntries(locationId: string, from: string, to: string): Promise<readonly ServiceCalendarEntry[]>;
  findEntryById(id: string): Promise<ServiceCalendarEntry | null>;
  /** One row per date in `[fromDate, toDate]`. `uq_service_calendar_date` is the race-free backstop; the returned `conflict` outcome also serves a pre-check for a friendly error. */
  createEntries(locationId: string, dates: readonly string[], isServiceDay: boolean, reason: string, createdBy: string): Promise<CreateServiceCalendarOutcome>;
  /** Sessions already scheduled on any of these dates, for the caller to see and cancel deliberately (API §3.3) rather than have this endpoint cancel them silently. */
  findConflictingSessions(locationId: string, dates: readonly string[]): Promise<readonly ConflictingSession[]>;
  updateEntry(id: string, input: { readonly isServiceDay: boolean | undefined; readonly reason: string | undefined; readonly expectedVersion: number }): Promise<UpdateServiceCalendarOutcome>;
  deleteEntry(id: string): Promise<DeleteServiceCalendarOutcome>;
}
