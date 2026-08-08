import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import {
  createDoctor,
  deactivateDoctor,
  deleteDoctor,
  fetchDoctorDetail,
  fetchDoctors,
  updateDoctor,
  type CreateDoctorInput,
  type DeactivateDoctorResultDto,
  type DoctorDetailDto,
  type DoctorListFilters,
  type DoctorListPageDto,
  type UpdateDoctorInput,
} from './api.js';

export function useDoctorsList(filters: DoctorListFilters): UseQueryResult<DoctorListPageDto> {
  return useQuery({
    queryKey: ['doctors', filters],
    queryFn: () => fetchDoctors(filters),
  });
}

export function useDoctorDetail(doctorId: string): UseQueryResult<DoctorDetailDto> {
  return useQuery({
    queryKey: ['doctors', doctorId],
    queryFn: () => fetchDoctorDetail(doctorId),
  });
}

function useInvalidateDoctors() {
  const queryClient = useQueryClient();
  return (doctorId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['doctors'] });
    if (doctorId !== undefined) void queryClient.invalidateQueries({ queryKey: ['doctors', doctorId] });
  };
}

export function useCreateDoctor(): UseMutationResult<DoctorDetailDto, Error, { readonly input: CreateDoctorInput; readonly csrfToken: string }> {
  const invalidate = useInvalidateDoctors();
  return useMutation({
    mutationFn: ({ input, csrfToken }) => createDoctor(input, csrfToken),
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useUpdateDoctor(doctorId: string): UseMutationResult<DoctorDetailDto, Error, { readonly input: UpdateDoctorInput; readonly csrfToken: string }> {
  const invalidate = useInvalidateDoctors();
  return useMutation({
    mutationFn: ({ input, csrfToken }) => updateDoctor(doctorId, input, csrfToken),
    onSuccess: () => {
      invalidate(doctorId);
    },
  });
}

export function useDeactivateDoctor(
  doctorId: string,
): UseMutationResult<DeactivateDoctorResultDto, Error, { readonly reason: string; readonly version: number; readonly csrfToken: string }> {
  const invalidate = useInvalidateDoctors();
  return useMutation({
    mutationFn: ({ reason, version, csrfToken }) => deactivateDoctor(doctorId, reason, version, csrfToken),
    onSuccess: () => {
      invalidate(doctorId);
    },
  });
}

export function useDeleteDoctor(doctorId: string): UseMutationResult<void, Error, { readonly csrfToken: string }> {
  const invalidate = useInvalidateDoctors();
  return useMutation({
    mutationFn: ({ csrfToken }) => deleteDoctor(doctorId, csrfToken),
    onSuccess: () => {
      invalidate(doctorId);
    },
  });
}
