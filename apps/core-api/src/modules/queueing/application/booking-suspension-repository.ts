/** S-14's richer read — `AppointmentRepository.findActiveSuspension` only ever needs `suspendedUntil` for the booking-time check; this also carries what the suspension notice's reason line is derived from. */
export interface BookingSuspensionDetail {
  readonly suspendedUntil: Date;
  readonly noShowCount: number;
}

/**
 * Spans two tables under one queueing-owned port, same as
 * `AppointmentRepository` already does for `identity.booking_suspension`
 * (the booking-time suspension check) — a No-show's consequence is a
 * queueing concern even though the row it writes lives in the `identity`
 * schema; module ownership and DB-schema boundaries are orthogonal here,
 * the same reasoning `scheduling` already applies reading `config.
 * service_calendar` directly.
 */
export interface BookingSuspensionRepository {
  /** BR-15's rolling window — counts `queueing.appointment` rows marked `no_show` for this student since `windowStart`, including one just recorded. */
  countRecentNoShows(studentId: string, windowStart: Date): Promise<number>;
  createSuspension(studentId: string, suspendedUntil: Date, noShowCount: number): Promise<void>;
  findActiveSuspensionDetail(studentId: string, now: Date): Promise<BookingSuspensionDetail | null>;
}
