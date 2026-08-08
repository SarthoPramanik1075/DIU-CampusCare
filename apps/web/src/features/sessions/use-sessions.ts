import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import {
  cancelSession,
  completeSession,
  createClinicSession,
  fetchClinicSessions,
  interruptSession,
  startSession,
  updateClinicSession,
  type CancelSessionResultDto,
  type ClinicSessionDto,
  type CompleteSessionResultDto,
  type CreateClinicSessionInput,
  type InterruptSessionResultDto,
  type UpdateClinicSessionInput,
} from './api.js';

export function useClinicSessions(from: string, to: string): UseQueryResult<{ readonly items: readonly ClinicSessionDto[]; readonly nextCursor: string | null }> {
  return useQuery({
    queryKey: ['sessions', from, to],
    queryFn: () => fetchClinicSessions(from, to),
  });
}

function useInvalidateSessions() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };
}

export function useCreateClinicSession(): UseMutationResult<ClinicSessionDto, Error, { readonly input: CreateClinicSessionInput; readonly csrfToken: string }> {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: ({ input, csrfToken }) => createClinicSession(input, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useUpdateClinicSession(sessionId: string): UseMutationResult<ClinicSessionDto, Error, { readonly input: UpdateClinicSessionInput; readonly csrfToken: string }> {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: ({ input, csrfToken }) => updateClinicSession(sessionId, input, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useStartSession(sessionId: string): UseMutationResult<ClinicSessionDto, Error, { readonly version: number; readonly csrfToken: string }> {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: ({ version, csrfToken }) => startSession(sessionId, version, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useInterruptSession(
  sessionId: string,
): UseMutationResult<InterruptSessionResultDto, Error, { readonly reason: string; readonly version: number; readonly csrfToken: string }> {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: ({ reason, version, csrfToken }) => interruptSession(sessionId, reason, version, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useCompleteSession(sessionId: string): UseMutationResult<CompleteSessionResultDto, Error, { readonly version: number; readonly csrfToken: string }> {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: ({ version, csrfToken }) => completeSession(sessionId, version, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useCancelSession(
  sessionId: string,
): UseMutationResult<CancelSessionResultDto, Error, { readonly reason: string; readonly version: number; readonly confirmedImpact: boolean; readonly csrfToken: string }> {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: ({ reason, version, confirmedImpact, csrfToken }) => cancelSession(sessionId, reason, version, confirmedImpact, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}
