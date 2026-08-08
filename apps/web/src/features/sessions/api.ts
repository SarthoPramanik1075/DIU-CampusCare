import { apiGet, apiPatch, apiPost } from '../../infrastructure/api-client.js';

const CORE_API_URL = import.meta.env.VITE_CORE_API_URL;

export type SessionStatus = 'scheduled' | 'started' | 'interrupted' | 'completed' | 'cancelled';

/** API §3.3's `GET /sessions` list-item shape. */
export interface ClinicSessionDto {
  readonly sessionId: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly sessionDate: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly slotLengthMinutes: number;
  readonly walkInAllocationPct: number;
  readonly totalSlotCount: number;
  readonly bookableSlotCount: number;
  readonly bookedSlotCount: number;
  readonly status: SessionStatus;
  readonly actuallyStartedAt: string | null;
  readonly actuallyEndedAt: string | null;
  readonly isOverride: boolean;
  readonly version: number;
}

export function fetchClinicSessions(from: string, to: string, doctorId?: string): Promise<{ readonly items: readonly ClinicSessionDto[]; readonly nextCursor: string | null }> {
  const params = new URLSearchParams({ from, to });
  if (doctorId !== undefined) params.set('doctorId', doctorId);
  return apiGet(CORE_API_URL, `/api/v1/sessions?${params.toString()}`);
}

export interface CreateClinicSessionInput {
  readonly doctorId: string;
  readonly sessionDate: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly slotLengthMinutes?: number;
  readonly walkInAllocationPct?: number;
  readonly changeReason?: string | null;
  readonly overrideNonServiceDay?: boolean;
}

export function createClinicSession(input: CreateClinicSessionInput, csrfToken: string): Promise<ClinicSessionDto> {
  return apiPost<ClinicSessionDto>(CORE_API_URL, '/api/v1/sessions', input, csrfToken);
}

export interface UpdateClinicSessionInput {
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly slotLengthMinutes?: number;
  readonly walkInAllocationPct?: number;
  readonly changeReason?: string;
  readonly version: number;
}

export function updateClinicSession(sessionId: string, input: UpdateClinicSessionInput, csrfToken: string): Promise<ClinicSessionDto> {
  return apiPatch<ClinicSessionDto>(CORE_API_URL, `/api/v1/sessions/${sessionId}`, input, csrfToken);
}

export function startSession(sessionId: string, version: number, csrfToken: string): Promise<ClinicSessionDto> {
  return apiPost<ClinicSessionDto>(CORE_API_URL, `/api/v1/sessions/${sessionId}/start`, { version }, csrfToken);
}

export interface InterruptSessionResultDto {
  readonly sessionId: string;
  readonly status: 'interrupted';
  readonly remainingPatients: number;
  readonly notificationsQueued: number;
  readonly version: number;
}

export function interruptSession(sessionId: string, reason: string, version: number, csrfToken: string): Promise<InterruptSessionResultDto> {
  return apiPost<InterruptSessionResultDto>(CORE_API_URL, `/api/v1/sessions/${sessionId}/interrupt`, { reason, version }, csrfToken);
}

export interface CompleteSessionResultDto {
  readonly sessionId: string;
  readonly status: 'completed';
  readonly actuallyEndedAt: string;
  readonly expiredAppointments: number;
  readonly version: number;
}

export function completeSession(sessionId: string, version: number, csrfToken: string): Promise<CompleteSessionResultDto> {
  return apiPost<CompleteSessionResultDto>(CORE_API_URL, `/api/v1/sessions/${sessionId}/complete`, { version }, csrfToken);
}

export interface CancelSessionResultDto {
  readonly sessionId: string;
  readonly status: 'cancelled';
  readonly cancelledAppointments: number;
  readonly notificationsQueued: number;
  readonly version: number;
}

export function cancelSession(sessionId: string, reason: string, version: number, confirmedImpact: boolean, csrfToken: string): Promise<CancelSessionResultDto> {
  return apiPost<CancelSessionResultDto>(CORE_API_URL, `/api/v1/sessions/${sessionId}/cancel`, { reason, version, confirmedImpact }, csrfToken);
}
