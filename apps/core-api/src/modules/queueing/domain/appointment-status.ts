/**
 * Domain layer — DR-6. FR-APT-28's lifecycle as pure predicates, mirroring
 * `modules/scheduling/domain/clinic-session.ts`'s style:
 *
 *   booked -> checked_in -> waiting -> in_consultation -> completed
 *
 * plus the terminal exception states `cancelled`, `late_cancellation`,
 * `no_show`, `expired`, reachable from earlier points in the main chain
 * but never from each other or from `completed`.
 */
export type AppointmentStatus =
  | 'booked'
  | 'checked_in'
  | 'waiting'
  | 'in_consultation'
  | 'completed'
  | 'cancelled'
  | 'late_cancellation'
  | 'no_show'
  | 'expired';

const TERMINAL_STATUSES: readonly AppointmentStatus[] = ['completed', 'cancelled', 'late_cancellation', 'no_show', 'expired'];

/** API §4.3 `POST /{id}/check-in` (VR-27) — only a `booked` appointment can be checked in. */
export function canCheckIn(status: AppointmentStatus): boolean {
  return status === 'booked';
}

/**
 * API §4.3 `POST /{id}/advance` (VR-28) — the single adjacent step forward
 * in the main chain. `check-in` is its own dedicated endpoint (above), so
 * `advance` only ever needs to know the three remaining forward steps.
 */
const ADVANCE_TRANSITIONS: Readonly<Record<AppointmentStatus, AppointmentStatus | undefined>> = {
  booked: undefined,
  checked_in: 'waiting',
  waiting: 'in_consultation',
  in_consultation: 'completed',
  completed: undefined,
  cancelled: undefined,
  late_cancellation: undefined,
  no_show: undefined,
  expired: undefined,
};

export function canAdvanceTo(status: AppointmentStatus, toStatus: AppointmentStatus): boolean {
  return ADVANCE_TRANSITIONS[status] === toStatus;
}

/** API §4.3 `POST /{id}/no-show` — a patient who was checked in or waiting and never made it in. `booked` is excluded: a no-show who never checked in at all is the ordinary session-expiry path (BR-22/EC-13), not this one. */
export function canMarkNoShow(status: AppointmentStatus): boolean {
  return status === 'checked_in' || status === 'waiting';
}

/** API §3.5's `cancel` — VR-26: only before the patient has arrived. Once checked in, EC-17 redirects the student to staff instead. */
export function canCancel(status: AppointmentStatus): boolean {
  return status === 'booked' || status === 'checked_in';
}

/**
 * API §4.3 `POST /{id}/reverse` (VR-32) — staff may undo exactly one step
 * back to the state that preceded the terminal/exception outcome, within
 * the same session. Reversal is deliberately not "any transition" — each
 * mapped source is the one state a mistaken action could have come from.
 */
const REVERSAL_TARGETS: Readonly<Partial<Record<AppointmentStatus, readonly AppointmentStatus[]>>> = {
  checked_in: ['booked'],
  waiting: ['checked_in'],
  in_consultation: ['waiting'],
  completed: ['in_consultation'],
  no_show: ['checked_in', 'waiting'],
};

export function canReverseTo(status: AppointmentStatus, toStatus: AppointmentStatus): boolean {
  return (REVERSAL_TARGETS[status] ?? []).includes(toStatus);
}

/** FR-APT-39 — an emergency designation is a reordering, not a status change; any non-terminal row may be marked, at most once. */
export function isTerminal(status: AppointmentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** F-01's `permittedTransitions` (API §4.2) — every action a console row may legally offer right now, driving the "one button per row" design (FRONTEND §9.2). */
export interface PermittedTransitions {
  readonly checkIn: boolean;
  readonly advanceTo: AppointmentStatus | null;
  readonly noShow: boolean;
  readonly cancel: boolean;
  readonly emergency: boolean;
}

export function permittedTransitions(status: AppointmentStatus): PermittedTransitions {
  return {
    checkIn: canCheckIn(status),
    advanceTo: ADVANCE_TRANSITIONS[status] ?? null,
    noShow: canMarkNoShow(status),
    cancel: canCancel(status),
    emergency: !isTerminal(status),
  };
}
