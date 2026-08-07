/**
 * Domain layer — DR-6: no framework, HTTP or persistence type may appear
 * here. Account lifecycle is a set of pure predicates over a status value;
 * the application layer decides what error to raise when a predicate
 * fails, this file only knows what is and isn't a legal move.
 */
export type AccountStatus = 'pending' | 'active' | 'suspended' | 'deactivated';

export interface UserAccount {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  readonly version: number;
}

/** API §1.15: current status must be `active` or `pending`. */
export function canSuspend(current: AccountStatus): boolean {
  return current === 'active' || current === 'pending';
}

/**
 * API §1.16 states two things that read as contradictory in isolation:
 * "current status is `pending` or `suspended`" as the validation rule, and
 * then "Reactivating a `deactivated` account is permitted and is audited
 * as such" in the same paragraph. This implements the union of both
 * statements — anything that isn't already `active` may become active —
 * since the second sentence is explicit and would otherwise be
 * unreachable.
 */
export function canActivate(current: AccountStatus): boolean {
  return current !== 'active';
}

/** API §1.17: any status except already-`deactivated`. */
export function canDeactivate(current: AccountStatus): boolean {
  return current !== 'deactivated';
}
