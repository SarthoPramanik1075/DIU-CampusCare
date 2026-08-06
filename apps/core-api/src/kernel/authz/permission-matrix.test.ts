import { ROLE_CODES, type RoleCode } from '@campuscare/shared-types';
import { describe, expect, it } from 'vitest';

import {
  CORE_PERMISSION_MATRIX,
  CORE_RESOURCE_NAMES,
  type CoreResourceName,
  type PermissionAction,
  type PermissionGrant,
} from './permission-matrix.js';

/**
 * An independent transcription of SRS §3.5.2, decoded from the same
 * shorthand the SRS document itself uses (C create · R read · U update ·
 * D delete · — none · "own" a scope qualifier). This is deliberately a
 * second reading of the requirement, not a copy of `permission-matrix.ts` —
 * a mistake made identically in both would have to be a misreading of the
 * SRS table itself, which is a much narrower failure mode than a typo in
 * one file.
 *
 * Column order matches the SRS table exactly: ANON, STU, DOC, MCS, STO, CNP, ADM.
 */
type Cell = '-' | 'R' | 'C' | 'RU' | 'CR' | 'CRU' | 'CRUD' | 'Rown' | 'RUown' | 'Cown' | 'CRUown';

const ROLE_ORDER: readonly RoleCode[] = [
  ROLE_CODES.ANON,
  ROLE_CODES.STU,
  ROLE_CODES.DOC,
  ROLE_CODES.MCS,
  ROLE_CODES.STO,
  ROLE_CODES.CNP,
  ROLE_CODES.ADM,
];

const SRS_TABLE: Readonly<Record<CoreResourceName, readonly Cell[]>> = {
  'public-availability-view': ['R', 'R', 'R', 'R', 'R', 'R', 'R'],
  'own-profile': ['-', 'RUown', 'RUown', 'RUown', 'RUown', 'RUown', 'RUown'],
  'user-accounts-and-roles': ['-', '-', '-', '-', '-', '-', 'CRUD'],
  'doctor-profiles': ['R', 'R', 'Rown', 'CRUD', '-', '-', 'R'],
  'doctor-schedules-and-sessions': ['R', 'R', 'R', 'CRUD', '-', '-', 'R'],
  'non-service-calendar': ['R', 'R', 'R', 'R', 'R', 'R', 'CRUD'],
  'appointment-own': ['-', 'CRUown', '-', '-', '-', '-', '-'],
  'appointment-any': ['-', '-', 'Rown', 'CRU', '-', '-', 'R'],
  'live-queue': ['R', 'Rown', 'Rown', 'RU', '-', '-', 'R'],
  'walk-in-registration': ['-', '-', '-', 'C', '-', '-', '-'],
  'emergency-designation': ['-', '-', '-', 'C', '-', '-', '-'],
  'reason-for-visit': ['-', 'Cown', 'Rown', 'R', '-', '-', '-'],
  'payment-record': ['-', 'Rown', '-', 'CRU', '-', '-', 'R'],
  'daily-collection-summary': ['-', '-', '-', 'R', '-', '-', 'R'],
  'medicine-catalogue': ['R', 'R', 'R', 'R', 'CRUD', 'R', 'R'],
  'medicine-stock-quantities': ['-', '-', '-', '-', 'RU', '-', 'R'],
  'stock-movements': ['-', '-', '-', '-', 'CR', '-', 'R'],
  'store-hours-and-status': ['R', 'R', 'R', 'R', 'CRU', 'R', 'R'],
  'notifications-own': ['-', 'RUown', 'RUown', 'RUown', 'RUown', 'RUown', 'RUown'],
  'notification-templates': ['-', '-', '-', '-', '-', '-', 'RU'],
  'system-configuration': ['-', '-', '-', '-', '-', '-', 'RU'],
  announcements: ['R', 'R', 'R', 'R', 'R', 'R', 'CRUD'],
  'general-audit-log': ['-', '-', '-', '-', '-', '-', 'R'],
  'data-export': ['-', '-', '-', '-', '-', '-', 'C'],
};

const ACTION_LETTERS: Record<'C' | 'R' | 'U' | 'D', PermissionAction> = {
  C: 'create',
  R: 'read',
  U: 'update',
  D: 'delete',
};

function decode(cell: Cell): PermissionGrant | undefined {
  if (cell === '-') return undefined;
  const scope = cell.endsWith('own') ? 'own' : 'any';
  const letters = cell.replace('own', '');
  // `letters` is always one of the fixed ASCII codes 'C'/'R'/'U'/'D' typed
  // above, so Array.from's simpler code-unit iteration is exactly as
  // correct as a locale-aware split would be, without tripping the spread
  // rule that exists to catch this on genuinely user-supplied text.
  const actions = Array.from(letters, (letter) => ACTION_LETTERS[letter as 'C' | 'R' | 'U' | 'D']);
  return { actions, scope };
}

describe('CORE_PERMISSION_MATRIX — against an independent transcription of SRS §3.5.2', () => {
  it('defines exactly the 24 core resources, and none of the 6 counseling ones', () => {
    expect(new Set(CORE_RESOURCE_NAMES).size).toBe(24);
    expect(Object.keys(CORE_PERMISSION_MATRIX).sort()).toEqual([...CORE_RESOURCE_NAMES].sort());

    const counselingResourceNames = [
      'counseling-availability',
      'counseling-request-own',
      'counseling-request-any',
      'counseling-case-and-notes',
      'counseling-case-existence',
      'counseling-access-log',
    ];
    for (const name of counselingResourceNames) {
      expect(CORE_RESOURCE_NAMES).not.toContain(name);
    }
  });

  it.each(CORE_RESOURCE_NAMES)('resource "%s" matches the SRS row exactly, role by role', (resource) => {
    const expectedRow = SRS_TABLE[resource];
    ROLE_ORDER.forEach((role, index) => {
      const expected = decode(expectedRow[index] ?? '-');
      const actual = CORE_PERMISSION_MATRIX[resource][role];

      if (expected === undefined) {
        expect(actual, `${resource} / ${role} should have no grant`).toBeUndefined();
        return;
      }
      expect(actual, `${resource} / ${role} should have a grant`).toBeDefined();
      expect(actual?.scope, `${resource} / ${role} scope`).toBe(expected.scope);
      expect([...(actual?.actions ?? [])].sort(), `${resource} / ${role} actions`).toEqual(
        [...expected.actions].sort(),
      );
    });
  });

  // PRM-02: absence of a rule is a denial, not an oversight. Every role/
  // resource pair not covered above resolves to `undefined` by construction
  // (Partial<Record<...>>), so there is nothing further to assert for those
  // cells — but this confirms the matrix has no stray keys beyond the seven
  // known role codes, which would otherwise be a silent typo (e.g. a role
  // code misspelled and therefore never matched by the PDP at all).
  it('never grants a role code outside the SRS §3.5.1 set', () => {
    const knownRoles = new Set<string>(Object.values(ROLE_CODES));
    for (const resource of CORE_RESOURCE_NAMES) {
      for (const role of Object.keys(CORE_PERMISSION_MATRIX[resource])) {
        expect(knownRoles.has(role), `${resource} grants an unknown role "${role}"`).toBe(true);
      }
    }
  });
});
