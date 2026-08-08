import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import {
  confirmUnavailability,
  deleteUnavailability,
  fetchDoctorUnavailability,
  previewUnavailability,
  type ConfirmUnavailabilityInput,
  type ConfirmUnavailabilityResultDto,
  type PreviewUnavailabilityInput,
  type PreviewUnavailabilityResultDto,
  type UnavailabilityRecordDto,
} from './api.js';

export function useDoctorUnavailability(doctorId: string): UseQueryResult<{ readonly items: readonly UnavailabilityRecordDto[] }> {
  return useQuery({
    queryKey: ['unavailability', doctorId],
    queryFn: () => fetchDoctorUnavailability(doctorId),
  });
}

/** Step 1/2 — writes only a short-lived preview row server-side, so no query invalidation follows. */
export function usePreviewUnavailability(
  doctorId: string,
): UseMutationResult<PreviewUnavailabilityResultDto, Error, { readonly input: PreviewUnavailabilityInput; readonly csrfToken: string }> {
  return useMutation({
    mutationFn: ({ input, csrfToken }) => previewUnavailability(doctorId, input, csrfToken),
  });
}

/** Step 2/2 — cancels affected sessions/appointments, so the doctor's session count, the unavailability list, and the week's schedule all need a refetch. */
export function useConfirmUnavailability(
  doctorId: string,
): UseMutationResult<ConfirmUnavailabilityResultDto, Error, { readonly input: ConfirmUnavailabilityInput; readonly csrfToken: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, csrfToken }) => confirmUnavailability(doctorId, input, csrfToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['unavailability', doctorId] });
      void queryClient.invalidateQueries({ queryKey: ['doctors', doctorId] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useDeleteUnavailability(
  doctorId: string,
  unavailabilityId: string,
): UseMutationResult<void, Error, { readonly reason: string; readonly csrfToken: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reason, csrfToken }) => deleteUnavailability(unavailabilityId, reason, csrfToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['unavailability', doctorId] });
    },
  });
}
