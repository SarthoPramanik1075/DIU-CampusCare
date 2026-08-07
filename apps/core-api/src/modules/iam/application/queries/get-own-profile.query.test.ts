import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationRepository } from '../authentication-repository.js';
import type { OwnProfileAccount, OwnProfileRepository, StudentProfile } from '../own-profile-repository.js';

import { GetOwnProfileQuery } from './get-own-profile.query.js';

const ACCOUNT: OwnProfileAccount = {
  id: 'user-1',
  email: 'student@diu.edu.bd',
  fullName: 'Nusrat Jahan',
  status: 'active',
  version: 4,
  authMethod: 'sso',
};

function buildQuery(overrides: {
  readonly account?: OwnProfileAccount | null;
  readonly studentProfile?: StudentProfile | null;
} = {}) {
  const repository: OwnProfileRepository = {
    findAccountById: vi.fn().mockResolvedValue(overrides.account === undefined ? ACCOUNT : overrides.account),
    findStudentProfile: vi.fn().mockResolvedValue(overrides.studentProfile ?? null),
    updateFullName: vi.fn(),
  };
  const authRepository: Pick<AuthenticationRepository, 'loadActiveRoleCodes'> = {
    loadActiveRoleCodes: vi.fn().mockResolvedValue(['STU']),
  };

  return { query: new GetOwnProfileQuery(repository, authRepository), repository, authRepository };
}

describe('GetOwnProfileQuery', () => {
  it('returns null when the account does not exist', async () => {
    const { query } = buildQuery({ account: null });
    expect(await query.execute('nonexistent')).toBeNull();
  });

  it('assembles the full profile: account fields, roles, and a null studentProfile for a non-student', async () => {
    const { query } = buildQuery();
    const profile = await query.execute('user-1');

    expect(profile).toEqual({
      userId: 'user-1',
      email: 'student@diu.edu.bd',
      fullName: 'Nusrat Jahan',
      status: 'active',
      roles: ['STU'],
      authMethod: 'sso',
      studentProfile: null,
      version: 4,
    });
  });

  it('includes studentProfile when the account has one', async () => {
    const studentProfile: StudentProfile = { studentRef: '221-15-5678', programme: 'BSc in CSE', isEnrolled: true };
    const { query } = buildQuery({ studentProfile });

    const profile = await query.execute('user-1');
    expect(profile?.studentProfile).toEqual(studentProfile);
  });
});
