import { describe, expect, it, vi } from 'vitest';

import type { AccountAdminRepository, AccountListPage } from '../account-admin-repository.js';

import { ListAccountsQuery } from './list-accounts.query.js';

const EMPTY_PAGE: AccountListPage = { items: [], nextCursor: null };

function buildQuery(overrides: { readonly repository?: Partial<AccountAdminRepository> } = {}) {
  const repository: AccountAdminRepository = {
    listAccounts: vi.fn().mockResolvedValue(EMPTY_PAGE),
    findAccountDetailById: vi.fn(),
    isEmailRegistered: vi.fn(),
    createAccount: vi.fn(),
    updateAccountAdmin: vi.fn(),
    transitionStatus: vi.fn(),
    findActiveAppointmentsForStudent: vi.fn(),
    ...overrides.repository,
  };
  return { query: new ListAccountsQuery(repository), repository };
}

describe('ListAccountsQuery', () => {
  it('rejects a search term under 2 characters', async () => {
    const { query, repository } = buildQuery();
    const result = await query.execute({ q: 'a' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(repository.listAccounts).not.toHaveBeenCalled();
  });

  it('defaults limit to 50', async () => {
    const { query, repository } = buildQuery();
    await query.execute({});
    expect(repository.listAccounts).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it('caps limit at 200', async () => {
    const { query, repository } = buildQuery();
    await query.execute({ limit: 5000 });
    expect(repository.listAccounts).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });

  it('passes filters through unchanged', async () => {
    const { query, repository } = buildQuery();
    await query.execute({ q: 'nusrat', status: 'active', role: 'STU', cursor: 'cursor-1' });
    expect(repository.listAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'nusrat', status: 'active', role: 'STU', cursor: 'cursor-1' }),
    );
  });
});
