import type { RoleCode } from '@campuscare/shared-types';

/**
 * Where a session lands with no `redirectTo` — FRONTEND Part 2's per-role
 * navigation contexts. When an account holds more than one role, the
 * console-facing roles win over the student view, on the assumption that
 * someone holding an operational role wants their console, not the
 * student dashboard, as their default landing.
 */
const ROLE_PRIORITY: readonly RoleCode[] = ['ADM', 'CNP', 'MCS', 'STO', 'DOC', 'STU'];

const LANDING_PATH_BY_ROLE: Readonly<Record<RoleCode, string>> = {
  ANON: '/',
  ADM: '/admin',
  CNP: '/counselor',
  MCS: '/staff',
  STO: '/operator',
  DOC: '/doctor',
  STU: '/student',
};

export function defaultLandingPath(roles: readonly RoleCode[]): string {
  const highestPriorityRole = ROLE_PRIORITY.find((role) => roles.includes(role));
  return highestPriorityRole !== undefined ? LANDING_PATH_BY_ROLE[highestPriorityRole] : '/';
}
