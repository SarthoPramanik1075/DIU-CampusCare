import { ValidationError } from '../../../../kernel/errors/domain-error.js';
import { err, ok, type Result } from '../../../../kernel/shared/result.js';
import type { AccountAdminRepository, AccountListFilter, AccountListPage } from '../account-admin-repository.js';

/** API §0.8: lists default to 50, cap at 200. A protocol convention, not a tunable business policy (DR-4 doesn't apply). */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MINIMUM_QUERY_LENGTH = 2;

export type ListAccountsInput = Omit<AccountListFilter, 'limit'> & { readonly limit?: number };

/** `GET /api/v1/users` (API §1.3) — the Administrator account console listing (FR-AUTH-12). */
export class ListAccountsQuery {
  constructor(private readonly repository: AccountAdminRepository) {}

  async execute(input: ListAccountsInput): Promise<Result<AccountListPage, ValidationError>> {
    if (input.q !== undefined && input.q.trim().length < MINIMUM_QUERY_LENGTH) {
      return err(
        new ValidationError({
          code: 'VALIDATION_FAILED',
          message: 'Search text must be at least 2 characters.',
          fields: [{ field: 'q', rule: 'API §1.3', message: 'Minimum 2 characters' }],
        }),
      );
    }

    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const page = await this.repository.listAccounts({ ...input, limit });
    return ok(page);
  }
}
