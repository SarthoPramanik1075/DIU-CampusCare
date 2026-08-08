import { apiGet } from '../../infrastructure/api-client.js';

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
