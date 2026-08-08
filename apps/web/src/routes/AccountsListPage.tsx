import { ROLE_NAMES, type AuthenticatedRoleCode } from '@campuscare/shared-types';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { AccountStatusDisplay } from '../features/accounts/AccountStatusDisplay.js';
import type { AccountDetailDto, AccountStatus } from '../features/accounts/api.js';
import { CreateAccountDialog } from '../features/accounts/CreateAccountDialog.js';
import { useAccountsList } from '../features/accounts/use-accounts.js';
import type { SessionDto } from '../features/auth/api.js';
import { ApiError } from '../infrastructure/api-client.js';
import { AdminShell } from '../shared/AdminShell.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button } from '../shared/primitives/Button.js';
import { Input } from '../shared/primitives/Input.js';
import { Skeleton } from '../shared/Skeleton.js';

import './AccountsListPage.css';

export interface AccountsListSearch {
  readonly q?: string;
  readonly status?: AccountStatus;
  readonly role?: AuthenticatedRoleCode;
}

export interface AccountsListPageProps {
  readonly session: SessionDto;
  readonly search: AccountsListSearch;
  readonly onSearchChange: (next: AccountsListSearch) => void;
  readonly onCreated: (account: AccountDetailDto) => void;
}

const ASSIGNABLE_ROLES: readonly AuthenticatedRoleCode[] = ['DOC', 'MCS', 'STO', 'CNP', 'ADM'];

/** `exactOptionalPropertyTypes` forbids `{ q: undefined }` — clearing a filter means removing the key, not nulling it. */
function withFilter<K extends keyof AccountsListSearch>(
  current: AccountsListSearch,
  key: K,
  value: AccountsListSearch[K] | undefined,
): AccountsListSearch {
  const { [key]: _omitted, ...rest } = current;
  return value === undefined ? rest : { ...rest, [key]: value };
}

/** A-02 (FRONTEND §10.6). Account metadata only — PRM-09 forbids surfacing appointment, payment, medicine or counseling information here. */
export function AccountsListPage({ session, search, onSearchChange, onCreated }: AccountsListPageProps): JSX.Element {
  const [queryText, setQueryText] = useState(search.q ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const accounts = useAccountsList(search);

  const searchTooShort = accounts.error instanceof ApiError && accounts.error.code === 'VALIDATION_FAILED';

  return (
    <AdminShell session={session} pageTitle="Accounts">
      <form
        className="cc-accounts-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchChange(withFilter(search, 'q', queryText.trim().length > 0 ? queryText.trim() : undefined));
        }}
      >
        <div className="cc-accounts-toolbar__search">
          <Input
            label="Search"
            value={queryText}
            onChange={setQueryText}
            placeholder="Name or email"
            type="search"
            {...(searchTooShort ? { error: 'Search text must be at least 2 characters.' } : {})}
          />
        </div>
        <div className="cc-accounts-toolbar__field">
          <label htmlFor="accounts-status-filter">Status</label>
          <select
            id="accounts-status-filter"
            value={search.status ?? ''}
            onChange={(event) => {
              const { value } = event.target;
              onSearchChange(withFilter(search, 'status', value.length > 0 ? (value as AccountStatus) : undefined));
            }}
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deactivated</option>
          </select>
        </div>
        <div className="cc-accounts-toolbar__field">
          <label htmlFor="accounts-role-filter">Role</label>
          <select
            id="accounts-role-filter"
            value={search.role ?? ''}
            onChange={(event) => {
              const { value } = event.target;
              onSearchChange(withFilter(search, 'role', value.length > 0 ? (value as AuthenticatedRoleCode) : undefined));
            }}
          >
            <option value="">All</option>
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_NAMES[role]}
              </option>
            ))}
          </select>
        </div>
        <Button variant="secondary" type="submit">
          Search
        </Button>
        <Button
          variant="primary"
          icon="plus"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          Create account
        </Button>
      </form>

      {accounts.isPending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }} aria-busy="true">
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="40px" />
        </div>
      )}

      {accounts.isError && !searchTooShort && (
        <Banner tone="danger" message="Accounts couldn't be loaded right now. Try refreshing the page." />
      )}

      {accounts.data?.items.length === 0 && (
        <p style={{ color: 'var(--color-text-secondary)' }}>No accounts match those filters.</p>
      )}

      {accounts.data !== undefined && accounts.data.items.length > 0 && (
        <table className="cc-accounts-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Roles</th>
              <th scope="col">Status</th>
              <th scope="col">Student ref</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {accounts.data.items.map((account) => (
              <tr key={account.userId}>
                <td>
                  <Link to="/admin/users/$userId" params={{ userId: account.userId }}>
                    {account.fullName}
                  </Link>
                </td>
                <td>{account.email}</td>
                <td>{account.roles.map((role) => ROLE_NAMES[role]).join(', ')}</td>
                <td>
                  <AccountStatusDisplay status={account.status} />
                </td>
                <td>{account.studentRef ?? '—'}</td>
                <td>{new Date(account.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CreateAccountDialog
        open={createOpen}
        csrfToken={session.csrfToken}
        onCreated={(account) => {
          setCreateOpen(false);
          onCreated(account);
        }}
        onCancel={() => {
          setCreateOpen(false);
        }}
      />
    </AdminShell>
  );
}
