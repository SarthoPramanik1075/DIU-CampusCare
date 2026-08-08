import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import {
  createServiceCalendarEntries,
  deleteServiceCalendarEntry,
  fetchServiceCalendar,
  updateServiceCalendarEntry,
  type CreateServiceCalendarEntriesInput,
  type CreateServiceCalendarEntriesResultDto,
  type ServiceCalendarEntryDto,
  type UpdateServiceCalendarEntryInput,
} from './api.js';

export function useServiceCalendarList(from: string, to: string): UseQueryResult<{ readonly items: readonly ServiceCalendarEntryDto[] }> {
  return useQuery({
    queryKey: ['admin', 'service-calendar', from, to],
    queryFn: () => fetchServiceCalendar(from, to),
  });
}

function useInvalidateServiceCalendar() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'service-calendar'] });
  };
}

export function useCreateServiceCalendarEntries(): UseMutationResult<
  CreateServiceCalendarEntriesResultDto,
  Error,
  { readonly input: CreateServiceCalendarEntriesInput; readonly csrfToken: string }
> {
  const invalidate = useInvalidateServiceCalendar();
  return useMutation({
    mutationFn: ({ input, csrfToken }) => createServiceCalendarEntries(input, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useUpdateServiceCalendarEntry(
  id: string,
): UseMutationResult<ServiceCalendarEntryDto, Error, { readonly input: UpdateServiceCalendarEntryInput; readonly csrfToken: string }> {
  const invalidate = useInvalidateServiceCalendar();
  return useMutation({
    mutationFn: ({ input, csrfToken }) => updateServiceCalendarEntry(id, input, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useDeleteServiceCalendarEntry(id: string): UseMutationResult<void, Error, { readonly csrfToken: string }> {
  const invalidate = useInvalidateServiceCalendar();
  return useMutation({
    mutationFn: ({ csrfToken }) => deleteServiceCalendarEntry(id, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}
