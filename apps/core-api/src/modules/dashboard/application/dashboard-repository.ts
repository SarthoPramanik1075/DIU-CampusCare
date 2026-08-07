import type { MedicineStoreState } from '../domain/medicine-store.js';

export interface BookingSuspensionState {
  readonly suspendedUntil: Date;
  readonly reason: string;
  readonly walkInRemainsAvailable: true;
}

/**
 * Port for `GET /me/dashboard`'s (API §2 DASH) two real-but-currently-empty
 * cross-module reads — no code in this module owns `pharmacy.store_hours`
 * or `identity.booking_suspension`, it only reads them to compose one
 * response, the same reasoning as `AccountAdminRepository.
 * findActiveAppointmentsForStudent` in `modules/iam`.
 */
export interface DashboardRepository {
  findMedicineStoreState(now: Date): Promise<MedicineStoreState>;
  /** `null` when the student has no active suspension — always true today, since nothing creates a row here until M2 ships no-show tracking. */
  findActiveBookingSuspension(studentId: string, now: Date): Promise<BookingSuspensionState | null>;
  countUnreadNotifications(recipientId: string): Promise<number>;
}
