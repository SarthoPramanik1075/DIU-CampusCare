import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { ApiError } from '../../infrastructure/api-client.js';

import { fetchSession, login, logout, type SessionDto } from './api.js';

export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

/**
 * `GET /auth/session` doubles as "am I signed in" — a `401 UNAUTHENTICATED`
 * is not an error state for this hook's purposes, it is the anonymous
 * state, so it resolves to `null` rather than leaving the query in an
 * error state every route guard would otherwise have to special-case.
 */
export function useSession(): UseQueryResult<SessionDto | null> {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      try {
        return await fetchSession();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => login(email, password),
    onSuccess: async () => {
      // The login response has no `email` field (API §1.3) — refetching
      // `GET /auth/session` gets the complete, real record rather than
      // hand-assembling a partial one with a fabricated `email`.
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (csrfToken: string) => logout(csrfToken),
    onSuccess: () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    },
  });
}
