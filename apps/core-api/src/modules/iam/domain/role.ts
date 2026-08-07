import type { AuthenticatedRoleCode } from '@campuscare/shared-types';

/** API §1.4 role catalogue, API §1.3/1.4 grant rules — `STU` accounts are provisioned by SSO, never by an Administrator. */
export function isRoleAssignableByAdmin(code: AuthenticatedRoleCode): boolean {
  return code !== 'STU';
}

/** VR-04 — only `CNP` requires the account to be flagged clinical staff first. */
export function roleRequiresClinicalStaff(code: AuthenticatedRoleCode): boolean {
  return code === 'CNP';
}
