import type { AuthenticatedRoleCode } from '@campuscare/shared-types';
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import {
  activateAccount,
  createAccount,
  deactivateAccount,
  fetchAccountDetail,
  fetchAccounts,
  fetchRoleCatalogue,
  grantRole,
  revokeRole,
  suspendAccount,
  updateAccount,
  type AccountDetailDto,
  type AccountListFilters,
  type AccountListPageDto,
  type CreateAccountInput,
  type DeactivateAccountResultDto,
  type RoleCatalogueEntryDto,
  type UpdateAccountInput,
} from './api.js';

export function useAccountsList(filters: AccountListFilters): UseQueryResult<AccountListPageDto> {
  return useQuery({
    queryKey: ['admin', 'accounts', filters],
    queryFn: () => fetchAccounts(filters),
  });
}

export function useAccountDetail(userId: string): UseQueryResult<AccountDetailDto> {
  return useQuery({
    queryKey: ['admin', 'accounts', userId],
    queryFn: () => fetchAccountDetail(userId),
  });
}

export function useRoleCatalogue(): UseQueryResult<{ readonly items: readonly RoleCatalogueEntryDto[] }> {
  return useQuery({
    queryKey: ['admin', 'roles'],
    // The catalogue is seed data (identity.role) — it does not change during a session.
    staleTime: Infinity,
    queryFn: fetchRoleCatalogue,
  });
}

function useInvalidateAccounts() {
  const queryClient = useQueryClient();
  return (userId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
    if (userId !== undefined) void queryClient.invalidateQueries({ queryKey: ['admin', 'accounts', userId] });
  };
}

export function useCreateAccount(): UseMutationResult<AccountDetailDto, Error, { readonly input: CreateAccountInput; readonly csrfToken: string }> {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ input, csrfToken }) => createAccount(input, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useUpdateAccount(
  userId: string,
): UseMutationResult<AccountDetailDto, Error, { readonly input: UpdateAccountInput; readonly csrfToken: string }> {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ input, csrfToken }) => updateAccount(userId, input, csrfToken),
    onSuccess: () => {
      invalidate(userId);
    },
  });
}

export function useSuspendAccount(
  userId: string,
): UseMutationResult<AccountDetailDto, Error, { readonly reason: string; readonly version: number; readonly csrfToken: string }> {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ reason, version, csrfToken }) => suspendAccount(userId, reason, version, csrfToken),
    onSuccess: () => {
      invalidate(userId);
    },
  });
}

export function useActivateAccount(
  userId: string,
): UseMutationResult<AccountDetailDto, Error, { readonly reason: string; readonly version: number; readonly csrfToken: string }> {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ reason, version, csrfToken }) => activateAccount(userId, reason, version, csrfToken),
    onSuccess: () => {
      invalidate(userId);
    },
  });
}

export function useDeactivateAccount(
  userId: string,
): UseMutationResult<
  DeactivateAccountResultDto,
  Error,
  { readonly reason: string; readonly version: number; readonly confirmedImpact: boolean; readonly csrfToken: string }
> {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ reason, version, confirmedImpact, csrfToken }) => deactivateAccount(userId, reason, version, confirmedImpact, csrfToken),
    onSuccess: () => {
      invalidate(userId);
    },
  });
}

export function useGrantRole(
  userId: string,
): UseMutationResult<AccountDetailDto, Error, { readonly roleCode: AuthenticatedRoleCode; readonly reason: string; readonly csrfToken: string }> {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ roleCode, reason, csrfToken }) => grantRole(userId, roleCode, reason, csrfToken),
    onSuccess: () => {
      invalidate(userId);
    },
  });
}

export function useRevokeRole(
  userId: string,
): UseMutationResult<AccountDetailDto, Error, { readonly roleCode: AuthenticatedRoleCode; readonly reason: string; readonly csrfToken: string }> {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ roleCode, reason, csrfToken }) => revokeRole(userId, roleCode, reason, csrfToken),
    onSuccess: () => {
      invalidate(userId);
    },
  });
}
