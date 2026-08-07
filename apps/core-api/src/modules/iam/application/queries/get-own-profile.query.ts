import type { RoleCode } from '@campuscare/shared-types';

import type { AuthenticationRepository } from '../authentication-repository.js';
import type { OwnProfileAccount, OwnProfileRepository, StudentProfile } from '../own-profile-repository.js';

export interface OwnProfile {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: OwnProfileAccount['status'];
  readonly roles: readonly RoleCode[];
  readonly authMethod: 'sso' | 'local';
  readonly studentProfile: StudentProfile | null;
  readonly version: number;
}

/**
 * Shared by the query below and `UpdateOwnProfileHandler` — both need to
 * render the exact same shape (API §1.2's `GET /me` response is also what
 * `PATCH /me` returns on success and what `CONFLICT_STALE_VERSION` embeds
 * as `details.current`), so there is exactly one place that assembles it.
 */
export async function assembleOwnProfile(
  account: OwnProfileAccount,
  repository: Pick<OwnProfileRepository, 'findStudentProfile'>,
  authRepository: Pick<AuthenticationRepository, 'loadActiveRoleCodes'>,
): Promise<OwnProfile> {
  const [roles, studentProfile] = await Promise.all([
    authRepository.loadActiveRoleCodes(account.id),
    repository.findStudentProfile(account.id),
  ]);

  return {
    userId: account.id,
    email: account.email,
    fullName: account.fullName,
    status: account.status,
    roles,
    authMethod: account.authMethod,
    studentProfile,
    version: account.version,
  };
}

/** `GET /api/v1/me` (API §1.2) — permission matrix `own-profile: R U` for every authenticated role. */
export class GetOwnProfileQuery {
  constructor(
    private readonly repository: OwnProfileRepository,
    private readonly authRepository: Pick<AuthenticationRepository, 'loadActiveRoleCodes'>,
  ) {}

  async execute(userAccountId: string): Promise<OwnProfile | null> {
    const account = await this.repository.findAccountById(userAccountId);
    if (account === null) return null;
    return assembleOwnProfile(account, this.repository, this.authRepository);
  }
}
