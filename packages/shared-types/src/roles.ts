/**
 * Role codes — SRS §3.5.1.
 *
 * These are the *identity* vocabulary shared by both services and the web
 * client. They are not an authorisation model: possession of a role code
 * grants nothing on its own.
 *
 * Two consequences worth stating here, because both are easy to get wrong:
 *
 *   • BR-03 / FR-AUTH-04 — a user may hold several roles and permissions are
 *     the union, **except** that counseling access is never granted by union.
 *
 *   • ADR-012 — a `CNP` code in a Core session assertion is *not* authority to
 *     read counseling data. The counseling service checks the subject against
 *     its own clinical roster and does not trust this claim. A forged `CNP`
 *     from a compromised IAM is still refused.
 */

export const ROLE_CODES = {
  /** Unauthenticated visitor. */
  ANON: 'ANON',
  /** Enrolled DIU student. */
  STU: 'STU',
  /** Consulting doctor. No Phase 1 function depends on this role logging in (CON-02). */
  DOC: 'DOC',
  /** Medical Center Staff — reception and operations. */
  MCS: 'MCS',
  /** Store Operator — medicine store custodian. */
  STO: 'STO',
  /** Counseling Professional. See the ADR-012 note above. */
  CNP: 'CNP',
  /** System Administrator — DIU IT. Explicitly denied counseling content (PRM-08). */
  ADM: 'ADM',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

/** Roles an authenticated session may carry. `ANON` is the absence of a session. */
export type AuthenticatedRoleCode = Exclude<RoleCode, 'ANON'>;

const ROLE_CODE_VALUES: readonly string[] = Object.values(ROLE_CODES);

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === 'string' && ROLE_CODE_VALUES.includes(value);
}

/**
 * Human-readable names. Used for administrative displays only; no
 * authorisation decision reads these.
 */
export const ROLE_NAMES: Readonly<Record<RoleCode, string>> = {
  ANON: 'Anonymous',
  STU: 'Student',
  DOC: 'Doctor',
  MCS: 'Medical Center Staff',
  STO: 'Store Operator',
  CNP: 'Counseling Professional',
  ADM: 'System Administrator',
};
