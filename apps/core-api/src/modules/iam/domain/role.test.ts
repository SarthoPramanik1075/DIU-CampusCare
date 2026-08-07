import { describe, expect, it } from 'vitest';

import { isRoleAssignableByAdmin, roleRequiresClinicalStaff } from './role.js';

describe('isRoleAssignableByAdmin', () => {
  it('rejects STU — student accounts are provisioned by SSO', () => {
    expect(isRoleAssignableByAdmin('STU')).toBe(false);
  });

  it('accepts every other role', () => {
    expect(isRoleAssignableByAdmin('DOC')).toBe(true);
    expect(isRoleAssignableByAdmin('MCS')).toBe(true);
    expect(isRoleAssignableByAdmin('STO')).toBe(true);
    expect(isRoleAssignableByAdmin('CNP')).toBe(true);
    expect(isRoleAssignableByAdmin('ADM')).toBe(true);
  });
});

describe('roleRequiresClinicalStaff — VR-04', () => {
  it('is true only for CNP', () => {
    expect(roleRequiresClinicalStaff('CNP')).toBe(true);
    expect(roleRequiresClinicalStaff('STU')).toBe(false);
    expect(roleRequiresClinicalStaff('ADM')).toBe(false);
  });
});
