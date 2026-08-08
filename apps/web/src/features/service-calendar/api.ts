import { apiDelete, apiGet, apiPatch, apiPost } from '../../infrastructure/api-client.js';

const CORE_API_URL = import.meta.env.VITE_CORE_API_URL;

/** API §2.6's public shape — no `id`/`version`, unlike the ADM maintenance view (§8.3). */
export interface PublicServiceCalendarEntryDto {
  readonly date: string;
  readonly isServiceDay: boolean;
  readonly reason: string;
}

export function fetchPublicServiceCalendar(from: string, to: string): Promise<{ readonly items: readonly PublicServiceCalendarEntryDto[] }> {
  return apiGet(CORE_API_URL, `/api/v1/public/service-calendar?from=${from}&to=${to}`);
}

/** API §8.3's ADM maintenance-view shape (A-06). */
export interface ServiceCalendarEntryDto {
  readonly id: string;
  readonly date: string;
  readonly isServiceDay: boolean;
  readonly reason: string;
  readonly createdBy: { readonly userId: string; readonly fullName: string };
  readonly createdAt: string;
  readonly version: number;
}

export interface ConflictingSessionDto {
  readonly sessionId: string;
  readonly doctorName: string;
  readonly sessionDate: string;
}

export function fetchServiceCalendar(from: string, to: string): Promise<{ readonly items: readonly ServiceCalendarEntryDto[] }> {
  return apiGet(CORE_API_URL, `/api/v1/service-calendar?from=${from}&to=${to}`);
}

export interface CreateServiceCalendarEntriesInput {
  readonly fromDate: string;
  readonly toDate?: string;
  readonly isServiceDay?: boolean;
  readonly reason: string;
}

export interface CreateServiceCalendarEntriesResultDto {
  readonly created: number;
  readonly items: readonly ServiceCalendarEntryDto[];
  readonly conflictingSessions: readonly ConflictingSessionDto[];
}

/** `locationId` is never a client input — the handler resolves the single Phase-1 location itself (OI-04/DB-3). */
export function createServiceCalendarEntries(input: CreateServiceCalendarEntriesInput, csrfToken: string): Promise<CreateServiceCalendarEntriesResultDto> {
  return apiPost<CreateServiceCalendarEntriesResultDto>(CORE_API_URL, '/api/v1/service-calendar', input, csrfToken);
}

export interface UpdateServiceCalendarEntryInput {
  readonly isServiceDay?: boolean;
  readonly reason?: string;
  readonly version: number;
}

export function updateServiceCalendarEntry(id: string, input: UpdateServiceCalendarEntryInput, csrfToken: string): Promise<ServiceCalendarEntryDto> {
  return apiPatch<ServiceCalendarEntryDto>(CORE_API_URL, `/api/v1/service-calendar/${id}`, input, csrfToken);
}

/** No body. `409 CANNOT_EDIT_PAST` when the entry's date has already happened — this is the "reopen" action, so undoing history isn't allowed. */
export function deleteServiceCalendarEntry(id: string, csrfToken: string): Promise<void> {
  return apiDelete<undefined>(CORE_API_URL, `/api/v1/service-calendar/${id}`, undefined, csrfToken);
}
