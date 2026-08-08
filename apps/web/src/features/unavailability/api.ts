import { apiDelete, apiGet, apiPost } from '../../infrastructure/api-client.js';

const CORE_API_URL = import.meta.env.VITE_CORE_API_URL;

/** API §3.4's `GET /doctors/{id}/unavailability` list-item shape. */
export interface UnavailabilityRecordDto {
  readonly unavailabilityId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export function fetchDoctorUnavailability(doctorId: string): Promise<{ readonly items: readonly UnavailabilityRecordDto[] }> {
  return apiGet(CORE_API_URL, `/api/v1/doctors/${doctorId}/unavailability`);
}

export interface PreviewUnavailabilityInput {
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
}

export interface AffectedAppointmentDto {
  readonly appointmentRef: string;
  readonly studentRef: string | null;
  readonly studentName: string | null;
  readonly sessionDate: string;
  readonly serialNumber: number;
  readonly paymentStatus: string;
  readonly requiresRefundFlag: boolean;
}

export interface AlternativeAvailabilityDto {
  readonly doctorName: string;
  readonly sessionDate: string;
  readonly remainingSlots: number;
}

/** API §3.4's step 1/2 — writes nothing but a short-lived preview row; never leaks `appointmentId`/`studentId`, only refs. */
export interface PreviewUnavailabilityResultDto {
  readonly previewToken: string;
  readonly expiresAt: string;
  readonly affectedSessions: number;
  readonly affectedAppointments: readonly AffectedAppointmentDto[];
  readonly alternativeAvailability: readonly AlternativeAvailabilityDto[];
}

export function previewUnavailability(doctorId: string, input: PreviewUnavailabilityInput, csrfToken: string): Promise<PreviewUnavailabilityResultDto> {
  return apiPost<PreviewUnavailabilityResultDto>(CORE_API_URL, `/api/v1/doctors/${doctorId}/unavailability/impact-preview`, input, csrfToken);
}

export interface ConfirmUnavailabilityInput {
  readonly previewToken: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
}

/** API §3.4's step 2/2. `startDate`/`endDate`/`reason` must match the preview call exactly — the server diffs the current affected set against the preview's snapshot and rejects with `IMPACT_CHANGED` on drift. */
export interface ConfirmUnavailabilityResultDto {
  readonly unavailabilityId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly cancelledAppointments: number;
  readonly notificationsQueued: number;
  readonly notificationDeadline: string;
  readonly paymentsFlaggedForRefund: number;
}

export function confirmUnavailability(doctorId: string, input: ConfirmUnavailabilityInput, csrfToken: string): Promise<ConfirmUnavailabilityResultDto> {
  return apiPost<ConfirmUnavailabilityResultDto>(CORE_API_URL, `/api/v1/doctors/${doctorId}/unavailability`, input, csrfToken);
}

/** Note the path root: `unavailabilityId`, not nested under `/doctors/{id}/` (API §3.4). */
export function deleteUnavailability(unavailabilityId: string, reason: string, csrfToken: string): Promise<void> {
  return apiDelete<undefined>(CORE_API_URL, `/api/v1/unavailability/${unavailabilityId}`, { reason }, csrfToken);
}
