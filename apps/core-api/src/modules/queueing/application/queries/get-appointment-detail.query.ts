import type { AppointmentDetail, AppointmentRepository } from '../appointment-repository.js';

export type AppointmentViewerRole = 'STU' | 'DOC' | 'MCS' | 'ADM';

export interface AppointmentViewer {
  readonly role: AppointmentViewerRole;
  readonly userId: string;
}

/**
 * `GET /api/v1/appointments/{id}` (API §4.1, F-03). Every role reads
 * through this one query — role-specific *shaping* (ADM's metadata-only
 * view) is the route's DTO mapper's job, but role-specific *existence*
 * (a student's or doctor's own-record check) happens here, because a
 * denied-vs-nonexistent distinction is exactly what PRM-09's anti-
 * enumeration rule forbids leaking: "a student requesting another
 * student's appointment receives 404, not 403" applies equally to a
 * doctor requesting another doctor's session. Returning `null` for both
 * "does not exist" and "exists but is not yours" is what makes that true
 * without the route ever needing to know which case it was.
 */
export class GetAppointmentDetailQuery {
  constructor(private readonly repository: AppointmentRepository) {}

  async execute(appointmentId: string, viewer: AppointmentViewer): Promise<AppointmentDetail | null> {
    const detail = await this.repository.findAppointmentDetail(appointmentId);
    if (detail === null) return null;

    if (viewer.role === 'STU') return detail.studentId === viewer.userId ? detail : null;
    if (viewer.role === 'DOC') return detail.doctorUserAccountId === viewer.userId ? detail : null;
    return detail;
  }
}
