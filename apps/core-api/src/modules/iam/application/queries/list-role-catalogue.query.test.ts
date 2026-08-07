import { describe, expect, it, vi } from 'vitest';

import type { AccountAdminRepository, RoleCatalogueEntry } from '../account-admin-repository.js';

import { ListRoleCatalogueQuery } from './list-role-catalogue.query.js';

describe('ListRoleCatalogueQuery', () => {
  it('returns whatever the repository provides', async () => {
    const catalogue: RoleCatalogueEntry[] = [
      { code: 'STU', name: 'Student', assignableByAdmin: false, requiresClinicalStaff: false },
      { code: 'CNP', name: 'Counseling Professional', assignableByAdmin: true, requiresClinicalStaff: true },
    ];
    const repository: Pick<AccountAdminRepository, 'listRoleCatalogue'> = {
      listRoleCatalogue: vi.fn().mockResolvedValue(catalogue),
    };
    const query = new ListRoleCatalogueQuery(repository);

    expect(await query.execute()).toEqual(catalogue);
  });
});
