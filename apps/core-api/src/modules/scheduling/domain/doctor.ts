/**
 * Domain layer — DR-6. Doctor lifecycle is a pure predicate over whether
 * appointment history exists, mirroring `modules/iam/domain/user-account.ts`'s
 * style: the application layer decides what error to raise when a
 * predicate fails, this file only knows what is and isn't a legal move.
 */

/** EC-20 — a doctor profile with any historical appointment may not be deleted, only deactivated. */
export function isDeletable(appointmentCount: number): boolean {
  return appointmentCount === 0;
}

/** API §3.1 `POST /{id}/deactivate` — already-inactive is refused (`ALREADY_INACTIVE`). */
export function canDeactivate(isActive: boolean): boolean {
  return isActive;
}
