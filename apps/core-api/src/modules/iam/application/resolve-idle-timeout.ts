import type { RoleCode } from '@campuscare/shared-types';

import type { PolicyStore } from '../../../kernel/policy/policy-store.js';

/**
 * FR-AUTH-06 names only two tiers (students; CNP/ADM) — a dual-role account,
 * or one holding DOC/MCS/STO, gets the shorter/stricter tier whenever it
 * holds anything beyond STU, the conservative reading when the SRS doesn't
 * enumerate every role explicitly. Shared by the login handler and
 * `GetSessionQuery` so the two can never compute a different answer for the
 * same session.
 */
export async function resolveIdleTimeoutMinutes(policyStore: PolicyStore, roles: readonly RoleCode[]): Promise<number> {
  const isNonStudentTier = roles.some((role) => role !== 'STU');
  const key = isNonStudentTier ? 'auth.session.idleTimeoutMinutes.staff' : 'auth.session.idleTimeoutMinutes.student';
  return policyStore.getRequiredInteger(key);
}
