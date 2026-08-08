import { apiGet } from '../../infrastructure/api-client.js';

export type PublicSessionStatus = 'scheduled' | 'started' | 'interrupted' | 'completed' | 'cancelled';

/** Wire shape of API.md §2.2 `GET /api/v1/public/availability`. No patient identity anywhere — only aggregate slot counts (BR-04). */
export interface PublicAvailabilitySessionDto {
  readonly sessionId: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly designation: string | null;
  readonly specialisation: string | null;
  readonly photoUrl: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: PublicSessionStatus;
  readonly bookableSlotCount: number;
  readonly bookedSlotCount: number;
  readonly remainingSlotCount: number;
}

/** Non-service days are included with `isServiceDay: false`, never omitted (FR-SCH-11/BR-28). */
export interface PublicAvailabilityDayDto {
  readonly date: string;
  readonly isServiceDay: boolean;
  readonly closureReason: string | null;
  readonly sessions: readonly PublicAvailabilitySessionDto[];
}

export interface PublicAvailabilityResponse {
  readonly days: readonly PublicAvailabilityDayDto[];
  readonly asOf: string;
  readonly publicationWindowDays: number;
}

const CORE_API_URL = import.meta.env.VITE_CORE_API_URL;

export function fetchPublicAvailability(): Promise<PublicAvailabilityResponse> {
  return apiGet<PublicAvailabilityResponse>(CORE_API_URL, '/api/v1/public/availability');
}
