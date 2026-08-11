/**
 * Domain layer — DR-6. FR-APT-04's `MED-<YYYY>-<sequence>` format. The
 * sequence value itself comes from `queueing.appointment_ref_seq`
 * (DDL-08) — a real database read, so that part lives in the repository.
 * This is the pure, testable half: given a year and a sequence number,
 * produce the exact string.
 */
const SEQUENCE_PAD_WIDTH = 4;

export function formatAppointmentRef(year: number, sequence: number): string {
  return `MED-${String(year)}-${String(sequence).padStart(SEQUENCE_PAD_WIDTH, '0')}`;
}
