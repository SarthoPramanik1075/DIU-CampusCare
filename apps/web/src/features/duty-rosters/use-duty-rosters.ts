import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import {
  createDutyRoster,
  deleteDutyRoster,
  fetchDutyRosters,
  updateDutyRoster,
  type CreateDutyRosterInput,
  type DutyRosterDto,
  type UpdateDutyRosterInput,
} from './api.js';

export function useDutyRosters(doctorId: string): UseQueryResult<{ readonly items: readonly DutyRosterDto[] }> {
  return useQuery({
    queryKey: ['duty-rosters', doctorId],
    queryFn: () => fetchDutyRosters(doctorId),
  });
}

function useInvalidateDutyRosters(doctorId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['duty-rosters', doctorId] });
  };
}

export function useCreateDutyRoster(doctorId: string): UseMutationResult<DutyRosterDto, Error, { readonly input: CreateDutyRosterInput; readonly csrfToken: string }> {
  const invalidate = useInvalidateDutyRosters(doctorId);
  return useMutation({
    mutationFn: ({ input, csrfToken }) => createDutyRoster(doctorId, input, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useUpdateDutyRoster(
  doctorId: string,
  rosterId: string,
): UseMutationResult<DutyRosterDto, Error, { readonly input: UpdateDutyRosterInput; readonly csrfToken: string }> {
  const invalidate = useInvalidateDutyRosters(doctorId);
  return useMutation({
    mutationFn: ({ input, csrfToken }) => updateDutyRoster(rosterId, input, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useDeleteDutyRoster(doctorId: string, rosterId: string): UseMutationResult<void, Error, { readonly reason: string; readonly csrfToken: string }> {
  const invalidate = useInvalidateDutyRosters(doctorId);
  return useMutation({
    mutationFn: ({ reason, csrfToken }) => deleteDutyRoster(rosterId, reason, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}
