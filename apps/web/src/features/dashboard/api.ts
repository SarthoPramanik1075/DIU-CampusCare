import { apiGet } from '../../infrastructure/api-client.js';

const CORE_API_URL = import.meta.env.VITE_CORE_API_URL;

/** API §2.1 `GET /api/v1/me/dashboard` wire shape. */
export interface DashboardDto {
  readonly student: { readonly fullName: string; readonly studentRef: string };
  readonly upcomingAppointments: readonly unknown[];
  readonly todaysDoctors: readonly unknown[];
  readonly medicineStore: {
    readonly isOpen: boolean;
    readonly opensAt: string | null;
    readonly closesAt: string | null;
    readonly stateSource: 'scheduled_hours' | 'manual_override';
  };
  readonly notifications: { readonly unreadCount: number };
  readonly announcements: readonly { readonly id: string; readonly body: string; readonly endsAt: string }[];
  readonly bookingSuspension: { readonly suspendedUntil: string; readonly reason: string; readonly walkInRemainsAvailable: boolean } | null;
}

export function fetchDashboard(): Promise<DashboardDto> {
  return apiGet<DashboardDto>(CORE_API_URL, '/api/v1/me/dashboard');
}
