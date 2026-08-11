import type { Clock } from '../../../../kernel/clock/clock.js';
import type { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { ClinicSessionListFilter, ListClinicSessionsQuery } from '../../../scheduling/index.js';
import type { AppointmentRepository } from '../appointment-repository.js';

export interface AvailabilitySessionItem {
  readonly sessionId: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly sessionDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly bookableSlotCount: number;
  readonly bookedSlotCount: number;
  readonly remainingSlotCount: number;
  readonly bookingBlocked: boolean;
  readonly studentAlreadyBooked: boolean;
}

/**
 * `GET /api/v1/availability` (API §4.1, S-02). The STU-authenticated
 * counterpart to `GET /api/v1/public/availability` (M2) — same underlying
 * session data, but augmented per-caller with `bookingBlocked` (an active
 * suspension) and `studentAlreadyBooked` (VR-22), so S-02's card can be
 * disabled with a reason "before the student hits a 409 they could have
 * been spared" (FRONTEND's own wording for this screen).
 */
export class GetAvailabilityQuery {
  constructor(
    private readonly listClinicSessions: ListClinicSessionsQuery,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * `studentId` is `null` for an authenticated non-student caller (staff
   * previewing availability) — the endpoint is `Session`-gated, not
   * `Session + Role(STU)`, per API §4.1, so a null student simply gets
   * both per-caller flags fixed at `false` rather than the query failing.
   */
  async execute(studentId: string | null, filter: ClinicSessionListFilter): Promise<Result<readonly AvailabilitySessionItem[], ValidationError>> {
    const result = await this.listClinicSessions.execute(filter);
    if (!result.ok) return err(result.error);

    const now = this.clock.now();
    const [suspension, bookedKeys] =
      studentId === null
        ? [null, new Set<string>()]
        : await Promise.all([this.appointmentRepository.findActiveSuspension(studentId, now), this.appointmentRepository.listActiveBookingKeysForStudent(studentId)]);
    const bookingBlocked = suspension !== null;

    const items = result.value.map((session) => ({
      sessionId: session.sessionId,
      doctorId: session.doctorId,
      doctorName: session.doctorName,
      sessionDate: session.sessionDate,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      bookableSlotCount: session.bookableSlotCount,
      bookedSlotCount: session.bookedSlotCount,
      remainingSlotCount: session.bookableSlotCount - session.bookedSlotCount,
      bookingBlocked,
      studentAlreadyBooked: bookedKeys.has(`${session.doctorId}:${session.sessionDate}`),
    }));

    return ok(items);
  }
}
