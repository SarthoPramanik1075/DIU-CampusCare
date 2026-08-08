/**
 * Domain layer — DR-6. Session lifecycle as pure predicates over
 * `scheduling.session_status` (`scheduled → started → interrupted →
 * completed`, `cancelled` from any non-terminal state), mirroring
 * `modules/iam/domain/user-account.ts`'s style.
 */
export type SessionStatus = 'scheduled' | 'started' | 'interrupted' | 'completed' | 'cancelled';

/** API §3.3 `POST /{id}/start` — a `scheduled` session starts; an `interrupted` one resumes (EC-04's "resume" choice reuses this same transition). */
export function canStart(status: SessionStatus): boolean {
  return status === 'scheduled' || status === 'interrupted';
}

/** API §3.3 `POST /{id}/interrupt` — only a running session can be interrupted. */
export function canInterrupt(status: SessionStatus): boolean {
  return status === 'started';
}

/** API §3.3 `POST /{id}/complete` — from running or interrupted (EC-04's "decide not to resume" choice). */
export function canComplete(status: SessionStatus): boolean {
  return status === 'started' || status === 'interrupted';
}

/** API §3.3 `POST /{id}/cancel` — any non-terminal state. */
export function canCancel(status: SessionStatus): boolean {
  return status !== 'completed' && status !== 'cancelled';
}

/** API §3.3 `PATCH /{id}` — times may not be edited once the session has started (`SESSION_ALREADY_STARTED`). */
export function canEditTimes(status: SessionStatus): boolean {
  return status === 'scheduled';
}
