import { apiGet } from '../../infrastructure/api-client.js';

/** Wire shape of API.md §2.5 `GET /api/v1/public/announcements`. */
export interface AnnouncementDto {
  readonly id: string;
  readonly body: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

interface AnnouncementsResponse {
  readonly items: readonly AnnouncementDto[];
}

const CORE_API_URL = import.meta.env.VITE_CORE_API_URL;

export async function fetchAnnouncements(): Promise<readonly AnnouncementDto[]> {
  const response = await apiGet<AnnouncementsResponse>(CORE_API_URL, '/api/v1/public/announcements');
  return response.items;
}
