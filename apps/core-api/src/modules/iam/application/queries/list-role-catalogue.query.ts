import type { AccountAdminRepository, RoleCatalogueEntry } from '../account-admin-repository.js';

/** `GET /api/v1/roles` (API §1.4) — the account console's role catalogue. */
export class ListRoleCatalogueQuery {
  constructor(private readonly repository: Pick<AccountAdminRepository, 'listRoleCatalogue'>) {}

  execute(): Promise<readonly RoleCatalogueEntry[]> {
    return this.repository.listRoleCatalogue();
  }
}
