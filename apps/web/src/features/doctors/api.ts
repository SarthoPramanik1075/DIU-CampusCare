import { apiDelete, apiGet, apiPatch, apiPost } from '../../infrastructure/api-client.js';

const CORE_API_URL = import.meta.env.VITE_CORE_API_URL;

/** API §3.1's `GET /doctors` list-item shape. */
export interface DoctorListItemDto {
  readonly doctorId: string;
  readonly fullName: string;
  readonly designation: string | null;
  readonly specialisation: string | null;
  readonly photoUrl: string | null;
  readonly isActive: boolean;
  readonly version: number;
}

export interface DoctorListPageDto {
  readonly items: readonly DoctorListItemDto[];
  readonly nextCursor: string | null;
}

export interface DoctorListFilters {
  readonly isActive?: boolean;
  readonly q?: string;
}

/** API §3.1's `GET /doctors/{id}` shape — counts only (BR-04), never appointment or patient data. */
export interface DoctorDetailDto {
  readonly doctorId: string;
  readonly userAccountId: string | null;
  readonly fullName: string;
  readonly designation: string | null;
  readonly specialisation: string | null;
  readonly photoUrl: string | null;
  readonly isActive: boolean;
  readonly activeRosterCount: number;
  readonly upcomingSessionCount: number;
  readonly version: number;
}

export interface DeactivateDoctorResultDto {
  readonly doctorId: string;
  readonly isActive: boolean;
  readonly affectedUpcomingSessions: number;
  readonly message: string;
  readonly version: number;
}

function buildQuery(filters: DoctorListFilters): string {
  const params = new URLSearchParams();
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  if (filters.q !== undefined && filters.q.length > 0) params.set('q', filters.q);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

export function fetchDoctors(filters: DoctorListFilters): Promise<DoctorListPageDto> {
  return apiGet<DoctorListPageDto>(CORE_API_URL, `/api/v1/doctors${buildQuery(filters)}`);
}

export function fetchDoctorDetail(doctorId: string): Promise<DoctorDetailDto> {
  return apiGet<DoctorDetailDto>(CORE_API_URL, `/api/v1/doctors/${doctorId}`);
}

export interface CreateDoctorInput {
  readonly fullName: string;
  readonly designation: string | null;
  readonly specialisation: string | null;
  readonly photoUrl: string | null;
}

export function createDoctor(input: CreateDoctorInput, csrfToken: string): Promise<DoctorDetailDto> {
  return apiPost<DoctorDetailDto>(CORE_API_URL, '/api/v1/doctors', input, csrfToken);
}

export interface UpdateDoctorInput {
  readonly fullName?: string;
  readonly designation?: string | null;
  readonly specialisation?: string | null;
  readonly photoUrl?: string | null;
  readonly version: number;
}

export function updateDoctor(doctorId: string, input: UpdateDoctorInput, csrfToken: string): Promise<DoctorDetailDto> {
  return apiPatch<DoctorDetailDto>(CORE_API_URL, `/api/v1/doctors/${doctorId}`, input, csrfToken);
}

export function deactivateDoctor(doctorId: string, reason: string, version: number, csrfToken: string): Promise<DeactivateDoctorResultDto> {
  return apiPost<DeactivateDoctorResultDto>(CORE_API_URL, `/api/v1/doctors/${doctorId}/deactivate`, { reason, version }, csrfToken);
}

/** No body (API §3.1's `DELETE /doctors/{id}`) — `204` on success, `409 DOCTOR_HAS_HISTORY` when appointments reference the doctor (EC-20). */
export function deleteDoctor(doctorId: string, csrfToken: string): Promise<void> {
  return apiDelete<undefined>(CORE_API_URL, `/api/v1/doctors/${doctorId}`, undefined, csrfToken);
}
